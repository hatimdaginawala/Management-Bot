import * as attendanceRepo from '../db/repositories/attendance.repository.js';
import * as userRepo from '../db/repositories/user.repository.js';
import * as eventRepo from '../db/repositories/event.repository.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Attendance service. Public API unchanged.
 */

// ============================================================
//  Reads
// ============================================================

export async function listAttendance({
  userDiscordId,
  eventId,
  eventTypeKey,
  from,
  to,
  includeInactive = false,
  page = 1,
  pageSize = 50,
} = {}) {
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(200, Math.max(1, Number(pageSize) || 50));

  const { items, total } = await attendanceRepo.list({
    userDiscordId,
    eventId,
    eventTypeKey,
    from,
    to,
    includeInactive,
    page,
    pageSize,
  });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getAttendanceHistory(discordId, { limit = 50 } = {}) {
  const user = await userRepo.findByDiscordId(discordId);
  if (!user) throw new NotFoundError('User', { discordId });

  const records = await attendanceRepo.historyForDiscordId(discordId, { limit });
  const activeCount = records.filter((r) => r.active).length;
  const inactiveCount = records.length - activeCount;

  return { user, records, activeCount, inactiveCount };
}

export async function attendanceStats({
  mode = 'total',
  from,
  to,
  limit = 10,
} = {}) {
  if (mode === 'total') {
    const counts = await attendanceRepo.distinctCountsInRange({ from, to });
    return { mode, total: counts.total };
  }

  if (mode === 'byUser') {
    const rows = await attendanceRepo.topAttendeesInRange({ from, to, limit });
    // Repo returns { discordId, count }
    return { mode, rows };
  }

  if (mode === 'byType') {
    const rows = await attendanceRepo.countByTypeInRange({ from, to });
    // Repo returns { typeKey, count }
    return { mode, rows: rows.map((r) => ({ _id: r.typeKey, count: r.count })) };
  }

  if (mode === 'byWeek') {
    // Aggregation by ISO week is not exposed via the repository yet.
    // Fall back to loading rows and grouping in JS for now.
    const { items } = await attendanceRepo.list({ from, to, pageSize: 200 });
    const buckets = new Map();
    for (const r of items) {
      const { year, week } = isoWeekParts(new Date(r.event_at));
      const key = year + '-' + String(week).padStart(2, '0');
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    const rows = Array.from(buckets.entries()).map(([k, count]) => {
      const [year, week] = k.split('-');
      return { _id: { year: Number(year), week: Number(week) }, count };
    });
    rows.sort((a, b) =>
      b._id.year - a._id.year || b._id.week - a._id.week
    );
    return { mode, rows: rows.slice(0, limit) };
  }

  throw new ValidationError('Unknown stats mode: ' + mode);
}

// ============================================================
//  Manual writes
// ============================================================

export async function addManualAttendance(actorDiscordId, {
  eventId,
  userDiscordId,
  reason = null,
} = {}) {
  if (!eventId) throw new ValidationError('eventId is required.');
  if (!userDiscordId) throw new ValidationError('userDiscordId is required.');
  if (reason !== null && typeof reason !== 'string') {
    throw new ValidationError('reason must be a string or null.');
  }

  const [event, user] = await Promise.all([
    eventRepo.findById(eventId),
    userRepo.findByDiscordId(userDiscordId),
  ]);
  if (!event) throw new NotFoundError('Event', { id: String(eventId) });
  if (!user) throw new NotFoundError('User', { discordId: userDiscordId });

  if (event.status !== 'APPROVED') {
    throw new ConflictError('Attendance can only be added to APPROVED events.');
  }
  if (event.host_discord_id === userDiscordId) {
    throw new ValidationError('The host cannot be added as an attendee.');
  }

  const record = await attendanceRepo.upsertManual({
    eventId: event.id,
    eventTypeKey: event.event_type_key,
    userId: user.id,
    discordId: user.discord_id,
    robloxId: user.roblox_id ?? null,
    eventAt: event.created_at,
    addedBy: actorDiscordId,
    reason,
  });

  await audit({
    actorId: actorDiscordId,
    action: 'attendance.manual_added',
    category: 'ATTENDANCE',
    targetType: 'Attendance',
    targetId: record.id,
    after: {
      eventId: event.id,
      userDiscordId,
      status: 'MANUAL_ADDED',
    },
    reason,
  });

  logger.info(
    { actorDiscordId, userDiscordId, eventId: event.id },
    'Manual attendance added'
  );

  return record;
}

export async function removeManualAttendance(actorDiscordId, {
  eventId,
  userDiscordId,
  reason,
} = {}) {
  if (!eventId) throw new ValidationError('eventId is required.');
  if (!userDiscordId) throw new ValidationError('userDiscordId is required.');
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required to remove attendance.');
  }

  const [event, user] = await Promise.all([
    eventRepo.findById(eventId),
    userRepo.findByDiscordId(userDiscordId),
  ]);
  if (!event) throw new NotFoundError('Event', { id: String(eventId) });
  if (!user) throw new NotFoundError('User', { discordId: userDiscordId });

  // Find the row to determine if it exists.
  const { items } = await attendanceRepo.list({
    userDiscordId,
    eventId: event.id,
    includeInactive: true,
    pageSize: 1,
  });
  const existing = items[0];
  if (!existing) {
    throw new NotFoundError('Attendance record', {
      eventId: String(eventId),
      userDiscordId,
    });
  }

  // Already inactive → no-op
  if (!existing.active) return existing;

  const removed = await attendanceRepo.deactivate(event.id, user.id, {
    removedBy: actorDiscordId,
    reason: reason.trim(),
  });
  if (!removed) return existing;

  await audit({
    actorId: actorDiscordId,
    action: 'attendance.manual_removed',
    category: 'ATTENDANCE',
    targetType: 'Attendance',
    targetId: existing.id,
    before: { active: true, status: 'PRESENT' },
    after: { active: false, status: 'MANUAL_REMOVED' },
    reason: reason.trim(),
  });

  const { items: after } = await attendanceRepo.list({
    userDiscordId,
    eventId: event.id,
    includeInactive: true,
    pageSize: 1,
  });
  return after[0];
}

// ============================================================
//  Convenience reads used by other services
// ============================================================

export async function countAttendanceForUser(userId, { from, to } = {}) {
  return attendanceRepo.countActiveForUserInRange(userId, { from, to });
}

export async function countAttendanceForEvent(eventId) {
  return attendanceRepo.countActiveForEvent(eventId);
}

// ============================================================
//  Internal helpers
// ============================================================

function isoWeekParts(date) {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return { year, week };
}
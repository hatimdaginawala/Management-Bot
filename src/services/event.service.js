// src/services/event.service.js

import * as eventRepo from '../db/repositories/event.repository.js';
import * as eventTypeRepo from '../db/repositories/eventType.repository.js';
import * as eventAttendeeRepo from '../db/repositories/eventAttendee.repository.js';
import * as attendanceRepo from '../db/repositories/attendance.repository.js';
import * as userRepo from '../db/repositories/user.repository.js';
import * as settingsRepo from '../db/repositories/settings.repository.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  ConflictError,
  NotFoundError,
} from '../utils/errors.js';
import logger from '../config/logger.js';
import { db } from '../db/client.js';
import { dmHost } from '../bot/buttons/eventApproval.js';
import { COLORS } from '../bot/embedBuilders.js';

const MAX_ATTENDEES = 200;
const DEFAULT_COOLDOWN_MINUTES = 5;
const DEFAULT_APPROVAL_REQUIRED = true;

// ============================================================
//  Settings helpers
// ============================================================

async function readSetting(key, fallback) {
  const row = await settingsRepo.findByKey(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

async function getEventSettings() {
  const [approvalRequired, cooldownMinutes] = await Promise.all([
    readSetting('events.approvalRequired', DEFAULT_APPROVAL_REQUIRED),
    readSetting('events.cooldownMinutes', DEFAULT_COOLDOWN_MINUTES),
  ]);
  return { approvalRequired, cooldownMinutes };
}

// ============================================================
//  Attendee normalization
// ============================================================

function normalizeAttendees(rawAttendees, hostDiscordId) {
  const seen = new Set();
  const result = [];

  for (const a of rawAttendees) {
    if (result.length >= MAX_ATTENDEES) break;
    const discordId = a.discordId ? String(a.discordId) : null;
    const robloxUsername = a.robloxUsername ? String(a.robloxUsername).trim() : null;

    if (!discordId && !robloxUsername) continue;
    if (discordId && discordId === hostDiscordId) continue;

    const key = discordId ?? ('rbx:' + robloxUsername.toLowerCase());
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      discordId: discordId ?? null,
      robloxUsername: robloxUsername ?? null,
      resolvedUserId: a.resolvedUserId ?? null,
      isVerified: Boolean(a.resolvedUserId),
    });
  }

  return result;
}

async function resolveAttendeeUsers(entries) {
  const withDiscordIds = entries.filter((e) => e.discordId);
  if (withDiscordIds.length === 0) return entries;

  const users = [];
  for (const entry of withDiscordIds) {
    const u = await userRepo.findByDiscordId(entry.discordId);
    if (u) users.push(u);
  }
  const byDiscordId = new Map(users.map((u) => [u.discord_id, u]));

  return entries.map((e) => {
    if (!e.discordId) return e;
    const u = byDiscordId.get(e.discordId);
    return {
      ...e,
      resolvedUserId: u ? u.id : null,
      isVerified: Boolean(u),
    };
  });
}

/**
 * Resolve a cohost spec ({ discordId }) to a full user record + Discord ID.
 * Returns null if not specified.
 */
async function resolveCohost(rawCohost, hostDiscordId) {
  if (!rawCohost) return null;

  const cohostDiscordId = rawCohost.discordId ? String(rawCohost.discordId) : null;
  if (!cohostDiscordId) return null;
  if (cohostDiscordId === hostDiscordId) {
    throw new ValidationError('The co-host cannot be the same user as the host.');
  }

  const user = await userRepo.findByDiscordId(cohostDiscordId);
  return {
    cohostUserId: user?.id ?? null,
    cohostDiscordId,
    cohostDiscordUsername: user?.discord_username ?? null,
  };
}

// ============================================================
//  Cooldown check
// ============================================================

async function checkCooldown(hostDiscordId, cooldownMs) {
  const last = await eventRepo.findLatestByHost(hostDiscordId);
  if (!last) return { allowed: true, retryAt: null };

  const lastAnchor = new Date(last.cooldown_anchor).getTime();
  const nextAllowed = new Date(lastAnchor + cooldownMs);
  if (nextAllowed <= new Date()) return { allowed: true, retryAt: null };
  return { allowed: false, retryAt: nextAllowed };
}

// ============================================================
//  Attendance fan-out
// ============================================================

async function writeAttendanceForEvent(event, attendees, trx = db) {
  const activeEntries = attendees.filter((e) => e.resolved_user_id);
  if (activeEntries.length === 0) return { created: 0, skipped: 0 };

  const rows = activeEntries.map((entry) => ({
    eventId: event.id,
    eventTypeKey: event.event_type_key,
    userId: entry.resolved_user_id,
    discordId: entry.discord_id,
    robloxId: null,
    eventAt: event.created_at,
    status: 'PRESENT',
  }));

  return attendanceRepo.ensurePresentBatch(rows, trx);
}

// ============================================================
//  Host DM helper
// ============================================================

async function notifyHost(client, event, {
  title,
  color,
  reason = null,
  extraLine = null,
  actorId = null,
} = {}) {
  if (!client) return;
  try {
    await dmHost(client, event, {
      title,
      color,
      approverId: actorId,
      reason,
      extraLine,
    });
  } catch (err) {
    logger.warn(
      { err: err.message, eventId: event.id },
      'Host DM failed (non-fatal)'
    );
  }
}

// ============================================================
//  createEvent
// ============================================================

export async function createEvent(actorDiscordId, payload) {
  const {
    eventTypeKey,
    attendees: rawAttendees = [],
    cohost: rawCohost = null,
    proofUrl,
    notes = '',
  } = payload;

  if (!eventTypeKey) throw new ValidationError('eventTypeKey is required.');
  if (!proofUrl || typeof proofUrl !== 'string') {
    throw new ValidationError('Proof URL is required.');
  }
  if (!/^https?:\/\//i.test(proofUrl.trim())) {
    throw new ValidationError('Proof URL must start with http:// or https://');
  }
  if (!Array.isArray(rawAttendees) || rawAttendees.length === 0) {
    throw new ValidationError('At least one attendee is required.');
  }

  const eventType = await eventTypeRepo.findByKey(eventTypeKey);
  if (!eventType || !eventType.active) {
    throw new NotFoundError('Event type', { key: eventTypeKey });
  }

  const { approvalRequired, cooldownMinutes } = await getEventSettings();
  const cooldownMs = cooldownMinutes * 60 * 1000;

  const { allowed, retryAt } = await checkCooldown(actorDiscordId, cooldownMs);
  if (!allowed) {
    const secs = Math.ceil((retryAt.getTime() - Date.now()) / 1000);
    throw new ConflictError('Please wait ' + secs + 's before logging another event.');
  }

  const host = await userRepo.findByDiscordId(actorDiscordId);
  const cohost = await resolveCohost(rawCohost, actorDiscordId);

  let entries = normalizeAttendees(rawAttendees, actorDiscordId);
  entries = await resolveAttendeeUsers(entries);

  if (entries.length === 0) {
    throw new ValidationError(
      'No valid attendees after removing the host and duplicates.'
    );
  }

  const status = approvalRequired ? 'PENDING' : 'APPROVED';

  const result = await db.transaction(async (trx) => {
    const created = await eventRepo.create({
      hostUserId: host?.id ?? null,
      hostDiscordId: actorDiscordId,
      hostDiscordUsername: host?.discord_username ?? null,
      hostRobloxId: host?.roblox_id ?? null,
      hostRobloxUsername: host?.roblox_username ?? null,
      cohostUserId: cohost?.cohostUserId ?? null,
      cohostDiscordId: cohost?.cohostDiscordId ?? null,
      cohostDiscordUsername: cohost?.cohostDiscordUsername ?? null,
      eventTypeId: eventType.id,
      eventTypeKey: eventType.key,
      proofUrl: proofUrl.trim(),
      notes: String(notes).slice(0, 2000),
      status,
      createdBy: actorDiscordId,
      cooldownAnchor: new Date(),
      ...(status === 'APPROVED'
        ? { approvedBy: actorDiscordId, approvedAt: new Date() }
        : {}),
    }, trx);

    const attendeeRows = await eventAttendeeRepo.insertMany(created.id, entries, trx);

    if (status === 'APPROVED') {
      await writeAttendanceForEvent(created, attendeeRows, trx);
    }

    return { event: created, attendees: attendeeRows };
  });

  await audit({
    actorId: actorDiscordId,
    action: status === 'APPROVED' ? 'event.created_auto_approved' : 'event.created',
    category: 'EVENT',
    targetType: 'Event',
    targetId: result.event.id,
    after: {
      eventTypeKey: result.event.event_type_key,
      status,
      attendees: entries.length,
      cohostDiscordId: cohost?.cohostDiscordId ?? null,
      proofUrl: result.event.proof_url,
    },
  });

  logger.info(
    {
      eventId: result.event.id,
      host: actorDiscordId,
      cohost: cohost?.cohostDiscordId ?? null,
      status,
      attendees: entries.length,
    },
    'Event created'
  );

  return {
    ...result.event,
    attendeeEntries: result.attendees.map(toAttendeeEntryShape),
  };
}

// ============================================================
//  approveEvent
// ============================================================

export async function approveEvent(actorDiscordId, eventId, { client = null } = {}) {
  const event = await eventRepo.approveAtomic(eventId, { approvedBy: actorDiscordId });

  if (!event) {
    const existing = await eventRepo.findById(eventId);
    if (!existing) throw new NotFoundError('Event', { id: String(eventId) });
    if (existing.status === 'APPROVED') {
      const attendees = await eventAttendeeRepo.listByEvent(existing.id);
      return {
        event: { ...existing, attendeeEntries: attendees.map(toAttendeeEntryShape) },
        alreadyApproved: true,
      };
    }
    throw new ConflictError('Cannot approve event with status ' + existing.status + '.');
  }

  const attendees = await eventAttendeeRepo.listByEvent(event.id);
  await writeAttendanceForEvent(event, attendees, db);

  await audit({
    actorId: actorDiscordId,
    action: 'event.approved',
    category: 'EVENT',
    targetType: 'Event',
    targetId: event.id,
    after: { status: 'APPROVED' },
  });

  const enriched = { ...event, attendeeEntries: attendees.map(toAttendeeEntryShape) };

  await notifyHost(client, enriched, {
    title: 'Event Approved',
    color: COLORS.SUCCESS,
    actorId: actorDiscordId,
    extraLine: 'Your event has been approved. Attendance has been credited.',
  });

  return { event: enriched, alreadyApproved: false };
}

// ============================================================
//  rejectEvent
// ============================================================

export async function rejectEvent(actorDiscordId, eventId, { reason, client = null } = {}) {
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('Rejection requires a reason.');
  }

  const event = await eventRepo.rejectAtomic(eventId, {
    rejectedBy: actorDiscordId,
    reason: reason.trim(),
  });

  if (!event) {
    const existing = await eventRepo.findById(eventId);
    if (!existing) throw new NotFoundError('Event', { id: String(eventId) });
    throw new ConflictError('Cannot reject event with status ' + existing.status + '.');
  }

  await audit({
    actorId: actorDiscordId,
    action: 'event.rejected',
    category: 'EVENT',
    targetType: 'Event',
    targetId: event.id,
    after: { status: 'REJECTED' },
    reason,
  });

  const attendees = await eventAttendeeRepo.listByEvent(event.id);
  const enriched = { ...event, attendeeEntries: attendees.map(toAttendeeEntryShape) };

  await notifyHost(client, enriched, {
    title: 'Event Rejected',
    color: COLORS.ERROR,
    actorId: actorDiscordId,
    reason: reason.trim(),
    extraLine: 'Your event was rejected. Contact High Command if you believe this is an error.',
  });

  return enriched;
}

// ============================================================
//  cancelEvent
// ============================================================

export async function cancelEvent(actorDiscordId, eventId, { reason = null, client = null } = {}) {
  const existing = await eventRepo.findById(eventId);
  if (!existing) throw new NotFoundError('Event', { id: String(eventId) });

  if (existing.status === 'CANCELLED') {
    const attendees = await eventAttendeeRepo.listByEvent(existing.id);
    return { ...existing, attendeeEntries: attendees.map(toAttendeeEntryShape) };
  }
  if (existing.status === 'REJECTED') {
    throw new ConflictError('Cannot cancel a rejected event.');
  }

  const previousStatus = existing.status;

  await db.transaction(async (trx) => {
    await eventRepo.updateById(existing.id, {
      status: 'CANCELLED',
      cancelledBy: actorDiscordId,
      cancelledAt: new Date(),
      cancellationReason: reason,
    }, trx);

    if (previousStatus === 'APPROVED') {
      await attendanceRepo.deleteByEvent(existing.id, trx);
    }
  });

  const updated = await eventRepo.findById(existing.id);
  const attendees = await eventAttendeeRepo.listByEvent(existing.id);

  await audit({
    actorId: actorDiscordId,
    action: 'event.cancelled',
    category: 'EVENT',
    targetType: 'Event',
    targetId: existing.id,
    before: { status: previousStatus },
    after: { status: 'CANCELLED' },
    reason,
  });

  const enriched = { ...updated, attendeeEntries: attendees.map(toAttendeeEntryShape) };

  await notifyHost(client, enriched, {
    title: 'Event Cancelled',
    color: COLORS.WARNING,
    actorId: actorDiscordId,
    reason,
    extraLine: 'Your event has been cancelled. Any attendance credited for it has been reversed.',
  });

  return enriched;
}

// ============================================================
//  updateEvent
// ============================================================

export async function updateEvent(actorDiscordId, eventId, patch) {
  const event = await eventRepo.findById(eventId);
  if (!event) throw new NotFoundError('Event', { id: String(eventId) });

  const before = {
    proofUrl: event.proof_url,
    notes: event.notes,
    attendeeCount: (await eventAttendeeRepo.listByEvent(event.id)).length,
    cohostDiscordId: event.cohost_discord_id,
  };

  let attendeesChanged = false;
  let newEntries = null;

  if (patch.proofUrl !== undefined) {
    if (!/^https?:\/\//i.test(String(patch.proofUrl))) {
      throw new ValidationError('Proof URL must start with http:// or https://');
    }
    await eventRepo.updateById(event.id, { proofUrl: String(patch.proofUrl).trim() });
  }
  if (patch.notes !== undefined) {
    await eventRepo.updateById(event.id, { notes: String(patch.notes).slice(0, 2000) });
  }
  if (patch.cohost !== undefined) {
    const cohost = await resolveCohost(patch.cohost, event.host_discord_id);
    await eventRepo.updateById(event.id, {
      cohostUserId: cohost?.cohostUserId ?? null,
      cohostDiscordId: cohost?.cohostDiscordId ?? null,
      cohostDiscordUsername: cohost?.cohostDiscordUsername ?? null,
    });
  }
  if (patch.attendees !== undefined) {
    if (!Array.isArray(patch.attendees) || patch.attendees.length === 0) {
      throw new ValidationError('Attendees array cannot be empty.');
    }
    newEntries = normalizeAttendees(patch.attendees, event.host_discord_id);
    newEntries = await resolveAttendeeUsers(newEntries);
    attendeesChanged = true;
  }

  if (attendeesChanged) {
    await db.transaction(async (trx) => {
      await eventAttendeeRepo.replaceForEvent(event.id, newEntries, trx);
      if (event.status === 'APPROVED') {
        await attendanceRepo.deleteByEvent(event.id, trx);
        await writeAttendanceForEvent(event, newEntries, trx);
      }
    });
  }

  const updated = await eventRepo.findById(event.id);
  const attendees = await eventAttendeeRepo.listByEvent(event.id);

  await audit({
    actorId: actorDiscordId,
    action: 'event.edited',
    category: 'EVENT',
    targetType: 'Event',
    targetId: event.id,
    before,
    after: {
      proofUrl: updated.proof_url,
      notes: updated.notes,
      attendeeCount: attendees.length,
      cohostDiscordId: updated.cohost_discord_id,
    },
  });

  return { ...updated, attendeeEntries: attendees.map(toAttendeeEntryShape) };
}

// ============================================================
//  Reads
// ============================================================

export async function getEvent(eventId) {
  const event = await eventRepo.findById(eventId);
  if (!event) throw new NotFoundError('Event', { id: String(eventId) });
  const attendees = await eventAttendeeRepo.listByEvent(event.id);
  return { ...event, attendeeEntries: attendees.map(toAttendeeEntryShape) };
}

export async function listEvents({
  status,
  hostDiscordId,
  eventTypeKey,
  from,
  to,
  page = 1,
  pageSize = 25,
} = {}) {
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));

  const { items, total } = await eventRepo.list({
    status,
    hostDiscordId,
    eventTypeKey,
    from,
    to,
    page,
    pageSize,
  });

  const enriched = await Promise.all(
    items.map(async (e) => {
      const attendees = await eventAttendeeRepo.listByEvent(e.id);
      return { ...e, attendeeEntries: attendees.map(toAttendeeEntryShape) };
    })
  );

  return {
    items: enriched,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getLastEventByHost(hostDiscordId) {
  return eventRepo.findLatestByHost(hostDiscordId);
}

// ============================================================
//  Helpers
// ============================================================

function toAttendeeEntryShape(row) {
  return {
    discordId: row.discord_id,
    robloxUsername: row.roblox_username,
    resolvedUserId: row.resolved_user_id,
    isVerified: row.is_verified,
  };
}
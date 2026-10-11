import {
  Attendance,
  User,
  Event,
} from '../models/index.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Attendance service.
 *
 * Read + manual write operations on the Attendance collection.
 * Automatic writes (event approval fan-out) live in event.service.
 *
 * Every manual operation is idempotent:
 *   - addManualAttendance upserts on (event, user).
 *   - removeManualAttendance updates in place; re-running is a no-op.
 *
 * Soft-delete semantics: removing attendance never deletes the row.
 * It flips `active: false` and `status: 'MANUAL_REMOVED'`, preserving
 * history for auditing and statistics.
 */

// ============================================================
//  Reads
// ============================================================

/**
 * List attendance records with filters + pagination.
 *
 * Filters:
 *   userDiscordId  - only records for this user
 *   eventId        - only records for this event
 *   eventTypeKey   - filter by event type
 *   from, to       - inclusive date range on eventAt
 *   includeInactive - default false; true includes MANUAL_REMOVED rows
 *   page, pageSize
 */
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
  const skip = (page - 1) * pageSize;

  const filter = {};
  if (!includeInactive) filter.active = true;
  if (userDiscordId) filter.discordId = userDiscordId;
  if (eventId) filter.event = eventId;
  if (eventTypeKey) filter.eventTypeKey = eventTypeKey.toLowerCase();

  if (from || to) {
    filter.eventAt = {};
    if (from) filter.eventAt.$gte = from;
    if (to) filter.eventAt.$lte = to;
  }

  const [items, total] = await Promise.all([
    Attendance.find(filter)
      .sort({ eventAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    Attendance.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Chronological attendance history for a single user.
 * Returns all records (active and inactive) so the caller can show
 * "was removed by admin" entries.
 */
export async function getAttendanceHistory(discordId, { limit = 50 } = {}) {
  const user = await User.findOne({ discordId }).lean();
  if (!user) throw new NotFoundError('User', { discordId });

  const records = await Attendance.find({ user: user._id })
    .sort({ eventAt: -1 })
    .limit(Math.min(200, Math.max(1, Number(limit) || 50)))
    .lean();

  const activeCount = records.filter((r) => r.active).length;
  const inactiveCount = records.length - activeCount;

  return { user, records, activeCount, inactiveCount };
}

/**
 * Aggregated attendance counts.
 *
 * Modes:
 *   - byUser:   top attendees in the time range
 *   - byType:   totals per event type
 *   - byWeek:   counts grouped by ISO week
 *   - total:    single number
 *
 * `from` and `to` are inclusive Date boundaries on `eventAt`.
 */
export async function attendanceStats({
  mode = 'total',
  from,
  to,
  limit = 10,
} = {}) {
  const match = { active: true };
  if (from || to) {
    match.eventAt = {};
    if (from) match.eventAt.$gte = from;
    if (to) match.eventAt.$lte = to;
  }

  if (mode === 'total') {
    const total = await Attendance.countDocuments(match);
    return { mode, total };
  }

  if (mode === 'byUser') {
    const rows = await Attendance.aggregate([
      { $match: match },
      { $group: { _id: '$user', count: { $sum: 1 }, discordId: { $first: '$discordId' } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: Math.min(100, Math.max(1, Number(limit) || 10)) },
    ]);
    return { mode, rows };
  }

  if (mode === 'byType') {
    const rows = await Attendance.aggregate([
      { $match: match },
      { $group: { _id: '$eventTypeKey', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    return { mode, rows };
  }

  if (mode === 'byWeek') {
    // Group by ISO year + week. Mongo's $isoWeek / $isoWeekYear are
    // available in MongoDB 3.4+, which we exceed.
    const rows = await Attendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            year: { $isoWeekYear: '$eventAt' },
            week: { $isoWeek: '$eventAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': -1, '_id.week': -1 } },
      { $limit: Math.min(100, Math.max(1, Number(limit) || 10)) },
    ]);
    return { mode, rows };
  }

  throw new ValidationError(`Unknown stats mode: ${mode}`);
}

// ============================================================
//  Manual writes
// ============================================================

/**
 * Manually add a user to an event's attendance.
 *
 * Behaviour:
 *   - If no row exists: create with status MANUAL_ADDED.
 *   - If a row exists and is active: no-op (return existing).
 *   - If a row exists and is inactive (previously removed):
 *     reactivate with status MANUAL_ADDED.
 *
 * The event MUST be APPROVED. Adding attendance to a PENDING event
 * would be inconsistent with how quota/statistics count "approved"
 * attendance. If the event is later approved, the normal fan-out
 * will run and skip this user (uniq_event_user prevents a second row).
 *
 * `eventAt` is taken from the event so weekly aggregation works
 * regardless of when the manual add happened.
 */
export async function addManualAttendance(
  actorDiscordId,
  { eventId, userDiscordId, reason = null } = {}
) {
  if (!eventId) throw new ValidationError('eventId is required.');
  if (!userDiscordId) throw new ValidationError('userDiscordId is required.');
  if (reason !== null && typeof reason !== 'string') {
    throw new ValidationError('reason must be a string or null.');
  }

  const [event, user] = await Promise.all([
    Event.findById(eventId).lean(),
    User.findOne({ discordId: userDiscordId }).lean(),
  ]);
  if (!event) throw new NotFoundError('Event', { id: String(eventId) });
  if (!user) throw new NotFoundError('User', { discordId: userDiscordId });

  if (event.status !== 'APPROVED') {
    throw new ConflictError(
      'Attendance can only be added to APPROVED events.'
    );
  }

  if (event.host?.discordId === userDiscordId) {
    throw new ValidationError('The host cannot be added as an attendee.');
  }

  const result = await Attendance.updateOne(
    { event: event._id, user: user._id },
    {
      $set: {
        event: event._id,
        eventTypeKey: event.eventTypeKey,
        user: user._id,
        discordId: user.discordId,
        robloxId: user.robloxId ?? null,
        eventAt: event.createdAt ?? new Date(),
        status: 'MANUAL_ADDED',
        addedBy: actorDiscordId,
        removedBy: null,
        reason,
        active: true,
      },
    },
    { upsert: true }
  );

  const record = await Attendance.findOne({ event: event._id, user: user._id }).lean();

  await audit({
    actorId: actorDiscordId,
    action: 'attendance.manual_added',
    category: 'ATTENDANCE',
    targetType: 'Attendance',
    targetId: record._id,
    after: {
      eventId: String(event._id),
      userDiscordId,
      status: 'MANUAL_ADDED',
    },
    reason,
  });

  logger.info(
    { actorDiscordId, userDiscordId, eventId: String(event._id), created: result.upsertedCount === 1 },
    'Manual attendance added'
  );

  return record;
}

/**
 * Soft-remove a user's attendance from an event.
 *
 * Behaviour:
 *   - If no row exists: throw NotFoundError (nothing to remove).
 *   - If a row exists and is inactive: no-op (return existing).
 *   - If a row exists and is active: set inactive + MANUAL_REMOVED.
 *
 * A reason is required.
 */
export async function removeManualAttendance(
  actorDiscordId,
  { eventId, userDiscordId, reason } = {}
) {
  if (!eventId) throw new ValidationError('eventId is required.');
  if (!userDiscordId) throw new ValidationError('userDiscordId is required.');
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required to remove attendance.');
  }

  const [event, user] = await Promise.all([
    Event.findById(eventId).lean(),
    User.findOne({ discordId: userDiscordId }).lean(),
  ]);
  if (!event) throw new NotFoundError('Event', { id: String(eventId) });
  if (!user) throw new NotFoundError('User', { discordId: userDiscordId });

  const existing = await Attendance.findOne({ event: event._id, user: user._id });
  if (!existing) {
    throw new NotFoundError('Attendance record', {
      eventId: String(eventId),
      userDiscordId,
    });
  }

  if (!existing.active) {
    // Already inactive — idempotent no-op.
    return existing.toObject();
  }

  existing.active = false;
  existing.status = 'MANUAL_REMOVED';
  existing.removedBy = actorDiscordId;
  existing.reason = reason.trim();
  await existing.save();

  await audit({
    actorId: actorDiscordId,
    action: 'attendance.manual_removed',
    category: 'ATTENDANCE',
    targetType: 'Attendance',
    targetId: existing._id,
    before: { active: true, status: 'PRESENT' },
    after: { active: false, status: 'MANUAL_REMOVED' },
    reason: reason.trim(),
  });

  return existing.toObject();
}

// ============================================================
//  Convenience reads used by other services
// ============================================================

/**
 * Count of active attendance for a user in a time range.
 * Used by quota evaluation (Phase 9).
 * `from` inclusive, `to` exclusive.
 */
export async function countAttendanceForUser(userObjectId, { from, to } = {}) {
  const filter = { user: userObjectId, active: true };
  if (from || to) {
    filter.eventAt = {};
    if (from) filter.eventAt.$gte = from;
    if (to) filter.eventAt.$lt = to;
  }
  return Attendance.countDocuments(filter);
}

/**
 * Total attendance recorded for an event (active only).
 * Used by /event view.
 */
export async function countAttendanceForEvent(eventObjectId) {
  return Attendance.countDocuments({ event: eventObjectId, active: true });
}
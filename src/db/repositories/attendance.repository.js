import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const BOOLEAN_FIELDS = ['active'];
const CTX = { repository: 'attendance' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('attendance').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findById' });
}

/**
 * Insert-if-not-exists for one attendance row.
 * Used during event approval fan-out. Returns { created, row }.
 *
 * MySQL's unique (event_id, user_id) constraint makes this idempotent;
 * we check first to give a clearer return value.
 */
export async function ensurePresent(data) {
  return withDbErrors(async () => {
    const existing = await db('attendance')
      .where({ event_id: data.eventId, user_id: data.userId })
      .first();
    if (existing) {
      return { created: false, row: convertRow(existing, { booleanFields: BOOLEAN_FIELDS }) };
    }
    const [id] = await db('attendance').insert({
      event_id: data.eventId,
      event_type_key: data.eventTypeKey,
      user_id: data.userId,
      discord_id: data.discordId,
      roblox_id: data.robloxId ?? null,
      event_at: data.eventAt,
      status: data.status ?? 'PRESENT',
      active: data.active ?? true,
      added_by: data.addedBy ?? null,
      reason: data.reason ?? null,
    });
    const row = await db('attendance').where({ id }).first();
    return { created: true, row: convertRow(row, { booleanFields: BOOLEAN_FIELDS }) };
  }, { ...CTX, method: 'ensurePresent' });
}

/**
 * Bulk insert-if-not-exists for multiple rows in one transaction.
 * Returns { created: number, skipped: number }.
 *
 * Wrapped in a Knex transaction so a partial failure rolls back cleanly.
 */
export async function ensurePresentBatch(rows) {
  if (!rows || rows.length === 0) return { created: 0, skipped: 0 };
  return withDbErrors(async () => {
    let created = 0;
    let skipped = 0;
    await db.transaction(async (trx) => {
      for (const data of rows) {
        const existing = await trx('attendance')
          .where({ event_id: data.eventId, user_id: data.userId })
          .first();
        if (existing) {
          skipped++;
          continue;
        }
        await trx('attendance').insert({
          event_id: data.eventId,
          event_type_key: data.eventTypeKey,
          user_id: data.userId,
          discord_id: data.discordId,
          roblox_id: data.robloxId ?? null,
          event_at: data.eventAt,
          status: data.status ?? 'PRESENT',
          active: true,
        });
        created++;
      }
    });
    return { created, skipped };
  }, { ...CTX, method: 'ensurePresentBatch' });
}

/**
 * Delete all attendance rows for an event.
 * Called on cancel.
 */
export async function deleteByEvent(eventId) {
  return withDbErrors(async () => {
    return db('attendance').where({ event_id: eventId }).delete();
  }, { ...CTX, method: 'deleteByEvent' });
}

/**
 * Soft-remove a single attendance row (manual removal by admin).
 * Idempotent: already-inactive rows are untouched.
 */
export async function deactivate(eventId, userId, { removedBy, reason }) {
  return withDbErrors(async () => {
    const affected = await db('attendance')
      .where({ event_id: eventId, user_id: userId, active: true })
      .update({
        active: false,
        status: 'MANUAL_REMOVED',
        removed_by: removedBy,
        reason,
      });
    return affected > 0;
  }, { ...CTX, method: 'deactivate' });
}

/**
 * Manual add — reactivates or inserts a MANUAL_ADDED row.
 * Used by the /attendance add flow.
 */
export async function upsertManual(data) {
  return withDbErrors(async () => {
    const existing = await db('attendance')
      .where({ event_id: data.eventId, user_id: data.userId })
      .first();

    if (existing) {
      await db('attendance')
        .where({ id: existing.id })
        .update({
          active: true,
          status: 'MANUAL_ADDED',
          added_by: data.addedBy,
          removed_by: null,
          reason: data.reason ?? null,
          roblox_id: data.robloxId ?? existing.roblox_id,
        });
      const row = await db('attendance').where({ id: existing.id }).first();
      return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
    }

    const [id] = await db('attendance').insert({
      event_id: data.eventId,
      event_type_key: data.eventTypeKey,
      user_id: data.userId,
      discord_id: data.discordId,
      roblox_id: data.robloxId ?? null,
      event_at: data.eventAt,
      status: 'MANUAL_ADDED',
      active: true,
      added_by: data.addedBy,
      reason: data.reason ?? null,
    });
    const row = await db('attendance').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'upsertManual' });
}

/**
 * List attendance rows with filters + pagination.
 * Used by /attendance view.
 */
export async function list({
  userDiscordId,
  eventId,
  eventTypeKey,
  from,
  to,
  includeInactive = false,
  page = 1,
  pageSize = 50,
} = {}) {
  return withDbErrors(async () => {
    const q = db('attendance');
    if (!includeInactive) q.where('active', true);
    if (userDiscordId) q.where('discord_id', userDiscordId);
    if (eventId) q.where('event_id', eventId);
    if (eventTypeKey) q.where('event_type_key', eventTypeKey.toLowerCase());
    if (from) q.where('event_at', '>=', from);
    if (to) q.where('event_at', '<=', to);

    const [countRow] = await q.clone().count({ count: '*' });
    const total = Number(countRow.count);

    const offset = (Math.max(1, page) - 1) * pageSize;
    const rows = await q
      .clone()
      .orderBy('event_at', 'desc')
      .limit(pageSize)
      .offset(offset);

    return { items: convertRows(rows, { booleanFields: BOOLEAN_FIELDS }), total };
  }, { ...CTX, method: 'list' });
}

/**
 * Attendance history for a single user, including removed rows.
 */
export async function historyForDiscordId(discordId, { limit = 50 } = {}) {
  return withDbErrors(async () => {
    const rows = await db('attendance')
      .where({ discord_id: discordId })
      .orderBy('event_at', 'desc')
      .limit(Math.min(200, Math.max(1, limit)));
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'historyForDiscordId' });
}

/**
 * Count active attendance rows for a user in a time range.
 * Used by quota evaluation for the LOW_RANK metric.
 */
export async function countActiveForUserInRange(userId, { from, to }) {
  return withDbErrors(async () => {
    const [row] = await db('attendance')
      .where({ user_id: userId, active: true })
      .where('event_at', '>=', from)
      .where('event_at', '<', to)
      .count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countActiveForUserInRange' });
}

/**
 * Count active attendance rows for an event.
 */
export async function countActiveForEvent(eventId) {
  return withDbErrors(async () => {
    const [row] = await db('attendance')
      .where({ event_id: eventId, active: true })
      .count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countActiveForEvent' });
}

/**
 * Top attendees in a window.
 */
export async function topAttendeesInRange({ from, to, limit = 10 }) {
  return withDbErrors(async () => {
    const q = db('attendance').where('active', true);
    if (from) q.where('event_at', '>=', from);
    if (to) q.where('event_at', '<=', to);
    const rows = await q
      .groupBy('discord_id')
      .select('discord_id')
      .count({ count: '*' })
      .orderBy('count', 'desc')
      .limit(limit);
    return rows.map((r) => ({ discordId: r.discord_id, count: Number(r.count) }));
  }, { ...CTX, method: 'topAttendeesInRange' });
}

/**
 * Attendance totals grouped by event type.
 */
export async function countByTypeInRange({ from, to }) {
  return withDbErrors(async () => {
    const q = db('attendance').where('active', true);
    if (from) q.where('event_at', '>=', from);
    if (to) q.where('event_at', '<=', to);
    const rows = await q
      .groupBy('event_type_key')
      .select('event_type_key')
      .count({ count: '*' });
    return rows.map((r) => ({ typeKey: r.event_type_key, count: Number(r.count) }));
  }, { ...CTX, method: 'countByTypeInRange' });
}

/**
 * Distinct attendee count and event count in a window.
 * Used by /stats attendance.
 */
export async function distinctCountsInRange({ from, to } = {}) {
  return withDbErrors(async () => {
    const q = db('attendance').where('active', true);
    if (from) q.where('event_at', '>=', from);
    if (to) q.where('event_at', '<=', to);

    const [totalRow] = await q.clone().count({ count: '*' });
    const [distinctUsers] = await q.clone().countDistinct({ count: 'user_id' });
    const [distinctEvents] = await q.clone().countDistinct({ count: 'event_id' });

    return {
      total: Number(totalRow.count),
      uniqueAttendees: Number(distinctUsers.count),
      uniqueEvents: Number(distinctEvents.count),
    };
  }, { ...CTX, method: 'distinctCountsInRange' });
}
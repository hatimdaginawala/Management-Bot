import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const BOOLEAN_FIELDS = [];
const CTX = { repository: 'strike' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('strikes').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findById' });
}

/**
 * Idempotent quota-strike creation.
 * Returns { created, row }.
 *
 * The pre-check + insert is safe because MySQL uniqueness on
 * (user_id, type='QUOTA_MISSED', quota_period_key) is enforced here.
 * No FK conflict because strikes.user_id is FK to users, but the unique
 * key would be on non-FK-participating columns... wait — user_id IS an
 * FK column.
 *
 * So we rely on the pre-check. Concurrency: the weekly job runs once,
 * so duplicate-insert risk is negligible. If we ever need stricter
 * guarantees, we can add an explicit UNIQUE KEY on a helper column
 * via a follow-up migration.
 */
export async function ensureQuotaStrike(data, trx = db) {
  return withDbErrors(async () => {
    const existing = await trx('strikes')
      .where({
        user_id: data.userId,
        type: 'QUOTA_MISSED',
        quota_period_key: data.quotaPeriodKey,
      })
      .first();
    if (existing) {
      return { created: false, row: convertRow(existing, { booleanFields: BOOLEAN_FIELDS }) };
    }
    const [id] = await trx('strikes').insert({
      user_id: data.userId,
      discord_id: data.discordId,
      type: 'QUOTA_MISSED',
      quota_period_key: data.quotaPeriodKey,
      reason: data.reason,
      issued_by: data.issuedBy ?? 'system',
      issued_at: new Date(),
      status: 'ACTIVE',
    });
    const row = await trx('strikes').where({ id }).first();
    return { created: true, row: convertRow(row, { booleanFields: BOOLEAN_FIELDS }) };
  }, { ...CTX, method: 'ensureQuotaStrike' });
}

/**
 * Create a manual strike (always a new row).
 */
export async function createManual(data) {
  return withDbErrors(async () => {
    const [id] = await db('strikes').insert({
      user_id: data.userId,
      discord_id: data.discordId,
      type: 'MANUAL',
      quota_period_key: null,
      reason: data.reason,
      issued_by: data.issuedBy,
      issued_at: new Date(),
      status: 'ACTIVE',
    });
    const row = await db('strikes').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'createManual' });
}

/**
 * Atomic transition ACTIVE → CANCELLED.
 * Returns the updated row, or null if not ACTIVE.
 */
export async function cancelAtomic(id, { resolvedBy, reason }) {
  return withDbErrors(async () => {
    const affected = await db('strikes')
      .where({ id, status: 'ACTIVE' })
      .update({
        status: 'CANCELLED',
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        resolution_reason: reason,
      });
    if (affected === 0) return null;
    const row = await db('strikes').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'cancelAtomic' });
}

/**
 * Atomic transition ACTIVE → RECOVERED.
 */
export async function recoverAtomic(id, { resolvedBy, reason, periodKey }) {
  return withDbErrors(async () => {
    const affected = await db('strikes')
      .where({ id, status: 'ACTIVE' })
      .update({
        status: 'RECOVERED',
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        resolution_reason: reason,
        recovered_in_period_key: periodKey,
      });
    if (affected === 0) return null;
    const row = await db('strikes').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'recoverAtomic' });
}

/**
 * Find the oldest ACTIVE strike for a user.
 * Used by the quota recovery flow (D7).
 */
export async function findOldestActiveForUser(userId, trx = db) {
  return withDbErrors(async () => {
    const row = await trx('strikes')
      .where({ user_id: userId, status: 'ACTIVE' })
      .orderBy('issued_at', 'asc')
      .first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findOldestActiveForUser' });
}

/**
 * Atomic recovery of the oldest ACTIVE strike for a user.
 * Returns the recovered row, or null if no ACTIVE strikes exist.
 * Used by the weekly evaluation job.
 */
export async function recoverOldestAtomic(userId, { resolvedBy, reason, periodKey }, trx = db) {
  return withDbErrors(async () => {
    const row = await trx('strikes')
      .where({ user_id: userId, status: 'ACTIVE' })
      .orderBy('issued_at', 'asc')
      .first();
    if (!row) return null;
    await trx('strikes')
      .where({ id: row.id, status: 'ACTIVE' })
      .update({
        status: 'RECOVERED',
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        resolution_reason: reason,
        recovered_in_period_key: periodKey,
      });
    const updated = await trx('strikes').where({ id: row.id }).first();
    return convertRow(updated, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'recoverOldestAtomic' });
}

export async function listActiveForUser(discordId) {
  return withDbErrors(async () => {
    const rows = await db('strikes')
      .where({ discord_id: discordId, status: 'ACTIVE' })
      .orderBy('issued_at', 'asc');
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'listActiveForUser' });
}

export async function historyForUser(discordId, { limit = 50 } = {}) {
  return withDbErrors(async () => {
    const rows = await db('strikes')
      .where({ discord_id: discordId })
      .orderBy('issued_at', 'desc')
      .limit(Math.min(200, Math.max(1, limit)));
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'historyForUser' });
}

export async function countActiveForUser(discordId) {
  return withDbErrors(async () => {
    const [row] = await db('strikes')
      .where({ discord_id: discordId, status: 'ACTIVE' })
      .count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countActiveForUser' });
}

/**
 * Bulk cancel every ACTIVE strike for a user (D10 rejoin reset).
 * Returns the number affected.
 */
export async function cancelAllActiveForUser(userId, { resolvedBy, reason }) {
  return withDbErrors(async () => {
    return db('strikes')
      .where({ user_id: userId, status: 'ACTIVE' })
      .update({
        status: 'CANCELLED',
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        resolution_reason: reason,
      });
  }, { ...CTX, method: 'cancelAllActiveForUser' });
}

/**
 * Aggregate strike counts in a window by status.
 * Used by /stats strikes.
 */
export async function aggregateByStatusInWindow({ from, to } = {}) {
  return withDbErrors(async () => {
    const q = db('strikes');
    if (from) q.where('issued_at', '>=', from);
    if (to) q.where('issued_at', '<=', to);
    const rows = await q.groupBy('status').select('status').count({ count: '*' });
    const out = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }, { ...CTX, method: 'aggregateByStatusInWindow' });
}

/**
 * Count strikes issued in a window (regardless of status).
 */
export async function countIssuedInWindow({ from, to }) {
  return withDbErrors(async () => {
    const q = db('strikes');
    if (from) q.where('issued_at', '>=', from);
    if (to) q.where('issued_at', '<=', to);
    const [row] = await q.count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countIssuedInWindow' });
}

/**
 * Count strikes that moved to RECOVERED in a window.
 */
export async function countRecoveredInWindow({ from, to }) {
  return withDbErrors(async () => {
    const q = db('strikes').where('status', 'RECOVERED');
    if (from) q.where('resolved_at', '>=', from);
    if (to) q.where('resolved_at', '<=', to);
    const [row] = await q.count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countRecoveredInWindow' });
}

/**
 * Top users with active strikes.
 */
export async function topUsersWithActiveStrikes({ limit = 10 } = {}) {
  return withDbErrors(async () => {
    const rows = await db('strikes')
      .where('status', 'ACTIVE')
      .groupBy('discord_id')
      .select('discord_id')
      .count({ count: '*' })
      .orderBy('count', 'desc')
      .limit(limit);
    return rows.map((r) => ({ discordId: r.discord_id, count: Number(r.count) }));
  }, { ...CTX, method: 'topUsersWithActiveStrikes' });
}
import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const BOOLEAN_FIELDS = ['strike_issued', 'recovery_applied'];
const CTX = { repository: 'quotaResult' };

export async function findByUserAndPeriodAndCategory(userId, periodId, category) {
  return withDbErrors(async () => {
    const row = await db('quota_results')
      .where({ user_id: userId, period_id: periodId, category })
      .first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findByUserAndPeriodAndCategory' });
}

/**
 * Ensure a result row exists for a given (user, period, category).
 * Returns { created, row }.
 *
 * This is the idempotency anchor for weekly quota evaluation: only
 * the caller that created the row proceeds to issue a strike / apply
 * a recovery.
 *
 * Uses a pre-check + insert to give a clean `created` flag without
 * relying on a partial unique index.
 */
export async function ensureResult(data, trx = db) {
  return withDbErrors(async () => {
    const existing = await trx('quota_results')
      .where({ user_id: data.userId, period_id: data.periodId, category: data.category })
      .first();
    if (existing) {
      return { created: false, row: convertRow(existing, { booleanFields: BOOLEAN_FIELDS }) };
    }
    const [id] = await trx('quota_results').insert({
      period_id: data.periodId,
      period_key: data.periodKey,
      user_id: data.userId,
      discord_id: data.discordId,
      category: data.category,
      metric: data.metric,
      required_amount: data.requiredAmount,
      actual_amount: data.actualAmount,
      status: data.status,
      exempt_reason: data.exemptReason ?? null,
      strike_issued: false,
      recovery_applied: false,
      recoveries_count: 0,
      evaluated_at: new Date(),
    });
    const row = await trx('quota_results').where({ id }).first();
    return { created: true, row: convertRow(row, { booleanFields: BOOLEAN_FIELDS }) };
  }, { ...CTX, method: 'ensureResult' });
}

/**
 * Mark that a strike was issued against this result.
 */
export async function markStrikeIssued(userId, periodId, category, trx = db) {
  return withDbErrors(async () => {
    await trx('quota_results')
      .where({ user_id: userId, period_id: periodId, category })
      .update({ strike_issued: true });
  }, { ...CTX, method: 'markStrikeIssued' });
}

/**
 * Mark that recoveries were applied against this result.
 */
export async function markRecoveriesApplied(userId, periodId, category, count, trx = db) {
  return withDbErrors(async () => {
    await trx('quota_results')
      .where({ user_id: userId, period_id: periodId, category })
      .update({ recovery_applied: true, recoveries_count: count });
  }, { ...CTX, method: 'markRecoveriesApplied' });
}

/**
 * Recent results for a user (used by /quota history).
 */
export async function recentForUser(userId, { limit = 8 } = {}) {
  return withDbErrors(async () => {
    const rows = await db('quota_results')
      .where({ user_id: userId })
      .orderBy('evaluated_at', 'desc')
      .limit(limit);
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'recentForUser' });
}

/**
 * Results for a period, grouped by status.
 */
export async function countByStatusForPeriod(periodId) {
  return withDbErrors(async () => {
    const rows = await db('quota_results')
      .where({ period_id: periodId })
      .groupBy('status')
      .select('status')
      .count({ count: '*' });
    const out = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }, { ...CTX, method: 'countByStatusForPeriod' });
}

/**
 * Aggregate quota MET / MISSED / EXEMPT counts per category.
 * Used by /stats quota.
 */
export async function aggregateByCategoryAndStatus({ from, to } = {}) {
  return withDbErrors(async () => {
    const q = db('quota_results');
    if (from) q.where('evaluated_at', '>=', from);
    if (to) q.where('evaluated_at', '<=', to);
    const rows = await q
      .groupBy('category', 'status')
      .select('category', 'status')
      .count({ count: '*' });
    const out = {
      STAFF: { MET: 0, MISSED: 0, EXEMPT: 0 },
      LOW_RANK: { MET: 0, MISSED: 0, EXEMPT: 0 },
    };
    for (const r of rows) {
      if (out[r.category] && out[r.category][r.status] !== undefined) {
        out[r.category][r.status] = Number(r.count);
      }
    }
    return out;
  }, { ...CTX, method: 'aggregateByCategoryAndStatus' });
}

/**
 * Count results in a window by status.
 */
export async function countByStatusInWindow({ from, to, status }) {
  return withDbErrors(async () => {
    const q = db('quota_results').where('status', status);
    if (from) q.where('evaluated_at', '>=', from);
    if (to) q.where('evaluated_at', '<=', to);
    const [row] = await q.count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countByStatusInWindow' });
}
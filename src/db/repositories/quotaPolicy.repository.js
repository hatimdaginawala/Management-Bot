import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const BOOLEAN_FIELDS = ['active'];
const CTX = { repository: 'quotaPolicy' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('quota_policies').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findById' });
}

export async function findActiveForCategory(category) {
  return withDbErrors(async () => {
    const row = await db('quota_policies')
      .where({ category, active: true })
      .whereNull('effective_to')
      .first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findActiveForCategory' });
}

export async function list({ category, includeExpired = true } = {}) {
  return withDbErrors(async () => {
    const q = db('quota_policies');
    if (category) q.where('category', category);
    if (!includeExpired) q.whereNull('effective_to');
    const rows = await q.orderBy([
      { column: 'category', order: 'asc' },
      { column: 'effective_from', order: 'desc' },
    ]);
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'list' });
}

/**
 * Close the currently-open policy for a category, if any.
 * Returns the previous policy id or null.
 *
 * @param {object} trx  Optional Knex transaction object
 */
export async function closeOpenForCategory(category, effectiveTo, trx = db) {
  return withDbErrors(async () => {
    const existing = await trx('quota_policies')
      .where({ category, active: true })
      .whereNull('effective_to')
      .first();
    if (!existing) return null;
    await trx('quota_policies')
      .where({ id: existing.id })
      .update({ active: false, effective_to: effectiveTo });
    return existing.id;
  }, { ...CTX, method: 'closeOpenForCategory' });
}

export async function create(data, trx = db) {
  return withDbErrors(async () => {
    const [id] = await trx('quota_policies').insert({
      category: data.category,
      metric: data.metric,
      amount: data.amount,
      period_kind: 'WEEKLY',
      effective_from: data.effectiveFrom ?? new Date(),
      effective_to: null,
      active: true,
      recovery_multiplier: data.recoveryMultiplier ?? 2,
      created_by: data.createdBy ?? 'system',
      notes: data.notes ?? null,
    });
    const row = await trx('quota_policies').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'create' });
}
import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const CTX = { repository: 'quotaPeriodPolicy' };

export async function listByPeriod(quotaPeriodId, trx = db) {
  return withDbErrors(async () => {
    const rows = await trx('quota_period_policies')
      .where({ quota_period_id: quotaPeriodId })
      .orderBy('category', 'asc');
    return convertRows(rows);
  }, { ...CTX, method: 'listByPeriod' });
}

/**
 * Insert snapshot rows for a period in one call.
 * Replaces any existing rows for the period (idempotent re-snapshot).
 */
export async function replaceForPeriod(quotaPeriodId, policies, trx = db) {
  return withDbErrors(async () => {
    await trx('quota_period_policies').where({ quota_period_id: quotaPeriodId }).delete();
    if (!policies || policies.length === 0) return [];
    const rows = policies.map((p) => ({
      quota_period_id: quotaPeriodId,
      policy_id: p.policyId,
      category: p.category,
      metric: p.metric,
      amount: p.amount,
      recovery_multiplier: p.recoveryMultiplier,
    }));
    await trx('quota_period_policies').insert(rows);
    return listByPeriod(quotaPeriodId, trx);
  }, { ...CTX, method: 'replaceForPeriod' });
}
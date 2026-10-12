import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const CTX = { repository: 'quotaPeriod' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('quota_periods').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'findById' });
}

export async function findByKey(periodKey) {
  return withDbErrors(async () => {
    const row = await db('quota_periods').where({ period_key: periodKey }).first();
    return convertRow(row);
  }, { ...CTX, method: 'findByKey' });
}

export async function findCurrentOpen() {
  return withDbErrors(async () => {
    const row = await db('quota_periods')
      .where('status', 'OPEN')
      .orderBy('start_at', 'desc')
      .first();
    return convertRow(row);
  }, { ...CTX, method: 'findCurrentOpen' });
}

export async function create(data, trx = db) {
  return withDbErrors(async () => {
    const [id] = await trx('quota_periods').insert({
      period_key: data.periodKey,
      start_at: data.startAt,
      end_at: data.endAt,
      status: data.status ?? 'OPEN',
      closed_at: null,
    });
    const row = await trx('quota_periods').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'create' });
}

/**
 * Atomically transition OPEN → CLOSING.
 * Returns the updated period, or null if it wasn't OPEN.
 * This is the CAS lock for weekly evaluation.
 */
export async function acquireClosingLock(periodKey) {
  return withDbErrors(async () => {
    const affected = await db('quota_periods')
      .where({ period_key: periodKey, status: 'OPEN' })
      .update({ status: 'CLOSING' });
    if (affected === 0) return null;
    const row = await db('quota_periods').where({ period_key: periodKey }).first();
    return convertRow(row);
  }, { ...CTX, method: 'acquireClosingLock' });
}

/**
 * Atomically transition CLOSING → CLOSED with metadata.
 */
export async function finalizePeriod(periodKey, {
  evaluatedCount = 0,
  strikesIssuedCount = 0,
  recoveriesAppliedCount = 0,
} = {}) {
  return withDbErrors(async () => {
    const affected = await db('quota_periods')
      .where({ period_key: periodKey, status: 'CLOSING' })
      .update({
        status: 'CLOSED',
        closed_at: new Date(),
        evaluated_count: evaluatedCount,
        strikes_issued_count: strikesIssuedCount,
        recoveries_applied_count: recoveriesAppliedCount,
      });
    if (affected === 0) return null;
    const row = await db('quota_periods').where({ period_key: periodKey }).first();
    return convertRow(row);
  }, { ...CTX, method: 'finalizePeriod' });
}

/**
 * List recent periods.
 */
export async function list({ limit = 50 } = {}) {
  return withDbErrors(async () => {
    const rows = await db('quota_periods')
      .orderBy('start_at', 'desc')
      .limit(limit);
    return convertRows(rows);
  }, { ...CTX, method: 'list' });
}
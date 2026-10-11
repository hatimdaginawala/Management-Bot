import { QuotaPeriod, QuotaPolicy, Settings } from '../models/index.js';
import { audit } from '../utils/audit.js';
import { isoWeekKey, isoWeekBounds, boundsFromKey, nextKey } from '../utils/isoWeek.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Quota period service.
 *
 * A period is one ISO week. Deterministic key (e.g. "2026-W41").
 * Status lifecycle:
 *   OPEN     → the current week, accepting events/attendance
 *   CLOSING  → being evaluated (evaluation service holds this briefly)
 *   CLOSED   → evaluated; historical
 *
 * The `policies` array on each period is a SNAPSHOT of the open policies
 * for each category at the moment the period was first opened. This is
 * the anchor for `.txt §21` ("changing the quota next week must not
 * rewrite historical quota results").
 */

/**
 * Return the currently OPEN period, or null.
 */
export async function getCurrentPeriod() {
  return QuotaPeriod.findOne({ status: 'OPEN' }).sort({ startAt: -1 }).lean();
}

/**
 * Return the OPEN period. If none exists, create it for the current
 * calendar week. This is the only place a period is opened.
 *
 * Never mutates an existing OPEN period.
 */
export async function getOrCreateCurrentPeriod({ actorId = 'system' } = {}) {
  const existing = await QuotaPeriod.findOne({ status: 'OPEN' });
  if (existing) return existing;

  const now = new Date();
  const key = isoWeekKey(now);
  const { startAt, endAt } = isoWeekBounds(now);

  // Snapshot current policies.
  const categories = ['STAFF', 'LOW_RANK'];
  const policies = [];
  for (const category of categories) {
    const p = await QuotaPolicy.findOne({ category, active: true, effectiveTo: null }).lean();
    if (p) {
      policies.push({
        policyId: p._id,
        category: p.category,
        metric: p.metric,
        amount: p.amount,
        recoveryMultiplier: p.recoveryMultiplier,
      });
    }
  }

  try {
    const period = await QuotaPeriod.create({
      periodKey: key,
      startAt,
      endAt,
      policies,
      status: 'OPEN',
    });

    // Best-effort: record in Settings for /quota status.
    await Settings.updateOne(
      { key: 'global' },
      { $set: { 'quotas.currentPeriodKey': key } }
    );

    await audit({
      actorId,
      action: 'quota.period_opened',
      category: 'QUOTA',
      targetType: 'QuotaPeriod',
      targetId: period._id,
      after: { periodKey: key, startAt, endAt, policies: policies.length },
    });

    logger.info({ periodKey: key, policies: policies.length }, 'Quota period opened');
    return period.toObject();
  } catch (err) {
    if (err.code === 11000) {
      // Concurrent open won; return the winner.
      return QuotaPeriod.findOne({ periodKey: key }).lean();
    }
    throw err;
  }
}

/**
 * Look up a period by its key.
 */
export async function getPeriodByKey(key) {
  const p = await QuotaPeriod.findOne({ periodKey: key }).lean();
  if (!p) throw new NotFoundError('Quota period', { key });
  return p;
}

/**
 * Atomically transition OPEN → CLOSING.
 * Returns the period on success, or null if it wasn't OPEN.
 */
export async function acquireClosingLock(key) {
  return QuotaPeriod.findOneAndUpdate(
    { periodKey: key, status: 'OPEN' },
    { $set: { status: 'CLOSING' } },
    { new: true }
  );
}

/**
 * Mark a period CLOSED with evaluation metadata.
 */
export async function finalizePeriod(key, {
  evaluatedCount = 0,
  strikesIssuedCount = 0,
  recoveriesAppliedCount = 0,
} = {}) {
  const p = await QuotaPeriod.findOneAndUpdate(
    { periodKey: key, status: 'CLOSING' },
    {
      $set: {
        status: 'CLOSED',
        closedAt: new Date(),
        evaluatedCount,
        strikesIssuedCount,
        recoveriesAppliedCount,
      },
    },
    { new: true }
  );
  if (!p) throw new ConflictError(`Period ${key} is not in CLOSING state.`);
  return p;
}

/**
 * Open the period that follows the given one.
 * Idempotent — if the next period already exists, returns it.
 */
export async function openNextPeriod(afterKey, { actorId = 'system' } = {}) {
  const key = nextKey(afterKey);
  const existing = await QuotaPeriod.findOne({ periodKey: key });
  if (existing) return existing.toObject();

  const { startAt, endAt } = boundsFromKey(key);

  const categories = ['STAFF', 'LOW_RANK'];
  const policies = [];
  for (const category of categories) {
    const p = await QuotaPolicy.findOne({ category, active: true, effectiveTo: null }).lean();
    if (p) {
      policies.push({
        policyId: p._id,
        category: p.category,
        metric: p.metric,
        amount: p.amount,
        recoveryMultiplier: p.recoveryMultiplier,
      });
    }
  }

  try {
    const period = await QuotaPeriod.create({
      periodKey: key,
      startAt,
      endAt,
      policies,
      status: 'OPEN',
    });
    await Settings.updateOne(
      { key: 'global' },
      { $set: { 'quotas.currentPeriodKey': key } }
    );
    await audit({
      actorId,
      action: 'quota.period_opened',
      category: 'QUOTA',
      targetType: 'QuotaPeriod',
      targetId: period._id,
      after: { periodKey: key, startAt, endAt },
    });
    return period.toObject();
  } catch (err) {
    if (err.code === 11000) {
      return QuotaPeriod.findOne({ periodKey: key }).lean();
    }
    throw err;
  }
}
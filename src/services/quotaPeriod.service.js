import * as quotaPeriodRepo from '../db/repositories/quotaPeriod.repository.js';
import * as quotaPolicyRepo from '../db/repositories/quotaPolicy.repository.js';
import * as quotaPeriodPolicyRepo from '../db/repositories/quotaPeriodPolicy.repository.js';
import * as settingsRepo from '../db/repositories/settings.repository.js';
import { audit } from '../utils/audit.js';
import { isoWeekKey, isoWeekBounds, boundsFromKey, nextKey } from '../utils/isoWeek.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import { db } from '../db/client.js';
import logger from '../config/logger.js';

/**
 * Quota period service. Public API unchanged.
 *
 * Policy snapshot at open time is stored in quota_period_policies.
 * The snapshot is what evaluation reads — historical results never
 * drift when policies change.
 */

const CATEGORIES = ['STAFF', 'LOW_RANK'];

// ============================================================
//  Reads
// ============================================================

export async function getCurrentPeriod() {
  const period = await quotaPeriodRepo.findCurrentOpen();
  if (!period) return null;
  return attachPolicies(period);
}

export async function getPeriodByKey(key) {
  const period = await quotaPeriodRepo.findByKey(key);
  if (!period) throw new NotFoundError('Quota period', { key });
  return attachPolicies(period);
}

async function attachPolicies(period) {
  const policies = await quotaPeriodPolicyRepo.listByPeriod(period.id);
  return {
    ...period,
    policies: policies.map((p) => ({
      policyId: p.policy_id,
      category: p.category,
      metric: p.metric,
      amount: p.amount,
      recoveryMultiplier: p.recovery_multiplier,
    })),
  };
}

// ============================================================
//  Open / create
// ============================================================

export async function getOrCreateCurrentPeriod({ actorId = 'system' } = {}) {
  const existing = await quotaPeriodRepo.findCurrentOpen();
  if (existing) return attachPolicies(existing);

  const now = new Date();
  const key = isoWeekKey(now);
  const { startAt, endAt } = isoWeekBounds(now);

  const result = await db.transaction(async (trx) => {
    // Snapshot current open policies.
    const policies = [];
    for (const category of CATEGORIES) {
      const p = await quotaPolicyRepo.findActiveForCategory(category);
      if (p) {
        policies.push({
          policyId: p.id,
          category: p.category,
          metric: p.metric,
          amount: p.amount,
          recoveryMultiplier: p.recovery_multiplier,
        });
      }
    }

    const period = await quotaPeriodRepo.create({
      periodKey: key,
      startAt,
      endAt,
      status: 'OPEN',
    }, trx);

    await quotaPeriodPolicyRepo.replaceForPeriod(period.id, policies, trx);

    return { period, policies };
  }).catch(async (err) => {
    // Duplicate key — another caller won the race. Reload.
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      const winner = await quotaPeriodRepo.findByKey(key);
      if (winner) return { period: winner };
    }
    throw err;
  });

  // Best-effort settings update for /quota status
  await settingsRepo.upsert('quotas.currentPeriodKey', 'quotas', key, 'string', {
    updatedBy: actorId,
  }).catch(() => {});

  await audit({
    actorId,
    action: 'quota.period_opened',
    category: 'QUOTA',
    targetType: 'QuotaPeriod',
    targetId: result.period.id,
    after: {
      periodKey: key,
      startAt,
      endAt,
      policies: result.policies?.length ?? 0,
    },
  });

  logger.info(
    { periodKey: key, policies: result.policies?.length ?? 0 },
    'Quota period opened'
  );

  return attachPolicies(result.period);
}

export async function openNextPeriod(afterKey, { actorId = 'system' } = {}) {
  const key = nextKey(afterKey);

  const existing = await quotaPeriodRepo.findByKey(key);
  if (existing) return attachPolicies(existing);

  const { startAt, endAt } = boundsFromKey(key);

  const result = await db.transaction(async (trx) => {
    const policies = [];
    for (const category of CATEGORIES) {
      const p = await quotaPolicyRepo.findActiveForCategory(category);
      if (p) {
        policies.push({
          policyId: p.id,
          category: p.category,
          metric: p.metric,
          amount: p.amount,
          recoveryMultiplier: p.recovery_multiplier,
        });
      }
    }

    const period = await quotaPeriodRepo.create({
      periodKey: key,
      startAt,
      endAt,
      status: 'OPEN',
    }, trx);

    await quotaPeriodPolicyRepo.replaceForPeriod(period.id, policies, trx);

    return { period, policies };
  }).catch(async (err) => {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      const winner = await quotaPeriodRepo.findByKey(key);
      if (winner) return { period: winner };
    }
    throw err;
  });

  await settingsRepo.upsert('quotas.currentPeriodKey', 'quotas', key, 'string', {
    updatedBy: actorId,
  }).catch(() => {});

  await audit({
    actorId,
    action: 'quota.period_opened',
    category: 'QUOTA',
    targetType: 'QuotaPeriod',
    targetId: result.period.id,
    after: { periodKey: key, startAt, endAt },
  });

  return attachPolicies(result.period);
}

// ============================================================
//  Close
// ============================================================

export async function acquireClosingLock(key) {
  const period = await quotaPeriodRepo.acquireClosingLock(key);
  if (!period) return null;
  return attachPolicies(period);
}

export async function finalizePeriod(key, {
  evaluatedCount = 0,
  strikesIssuedCount = 0,
  recoveriesAppliedCount = 0,
} = {}) {
  const p = await quotaPeriodRepo.finalizePeriod(key, {
    evaluatedCount,
    strikesIssuedCount,
    recoveriesAppliedCount,
  });
  if (!p) throw new ConflictError('Period ' + key + ' is not in CLOSING state.');
  return attachPolicies(p);
}
import * as userRepo from '../db/repositories/user.repository.js';
import * as leaveRepo from '../db/repositories/leave.repository.js';
import * as noticeRepo from '../db/repositories/notice.repository.js';
import * as eventRepo from '../db/repositories/event.repository.js';
import * as attendanceRepo from '../db/repositories/attendance.repository.js';
import * as quotaResultRepo from '../db/repositories/quotaResult.repository.js';
import * as quotaPeriodRepo from '../db/repositories/quotaPeriod.repository.js';
import * as strikeRepo from '../db/repositories/strike.repository.js';
import {
  getPeriodByKey,
  acquireClosingLock,
  finalizePeriod,
  openNextPeriod,
} from './quotaPeriod.service.js';
import { audit } from '../utils/audit.js';
import { db } from '../db/client.js';
import logger from '../config/logger.js';

/**
 * Weekly quota evaluation. Public API unchanged.
 *
 * Idempotency:
 *   1. acquireClosingLock CAS on quota_periods.status OPEN → CLOSING.
 *   2. ensureResult on quota_results (user, period, category) — only the
 *      creator issues a strike or applies a recovery.
 *   3. strikeRepo.ensureQuotaStrike — belt-and-suspenders.
 *
 * `onStrikeIssued` is the callback the job passes to fire DMs.
 */

const MAX_PERIOD_RESULTS = 100_000;

// ============================================================
//  Public entry point
// ============================================================

export async function evaluatePeriod(periodKey, {
  actorId = 'system',
  dryRun = false,
  onStrikeIssued = null,
} = {}) {
  const period = await getPeriodByKey(periodKey);

  if (period.status === 'CLOSED') {
    logger.info({ periodKey }, 'Period already CLOSED — skipping');
    return { status: 'ALREADY_CLOSED', evaluated: 0, strikesIssued: 0, recoveriesApplied: 0, skipped: 0 };
  }

  const locked = await acquireClosingLock(periodKey);
  if (!locked) {
    logger.info({ periodKey, status: period.status }, 'Period not OPEN — skipping');
    return { status: 'NOT_OPEN', evaluated: 0, strikesIssued: 0, recoveriesApplied: 0, skipped: 0 };
  }

  const stats = { evaluated: 0, strikesIssued: 0, recoveriesApplied: 0, skipped: 0 };

  try {
    const policyByCategory = new Map(
      (locked.policies ?? []).map((p) => [p.category, p])
    );

    // Eligible users
    const { items: eligible } = await userRepo.list({
      status: 'ACTIVE',
      quotaCategory: undefined,
      page: 1,
      pageSize: MAX_PERIOD_RESULTS,
    });

    const eligibleUsers = eligible.filter((u) =>
      u.quota_category === 'STAFF' || u.quota_category === 'LOW_RANK'
    );

    // Leaves overlapping the period
    const leaveUserIds = await leaveRepo.findOverlappingApprovedInPeriod(locked);
    const onLeave = new Set(leaveUserIds.map(String));

    // Quota-exempting notices overlapping the period
    const noticeUserIds = await noticeRepo.findActiveExemptOverlappingPeriod(locked);
    const hasNotice = new Set(noticeUserIds.map(String));

    for (const user of eligibleUsers) {
      try {
        const result = await evaluateOneUser({
          user,
          period: locked,
          policyByCategory,
          onLeave,
          hasNotice,
          dryRun,
          onStrikeIssued,
        });
        stats.evaluated++;
        stats.strikesIssued += result.strikeIssued ? 1 : 0;
        stats.recoveriesApplied += result.recoveriesApplied || 0;
      } catch (err) {
        stats.skipped++;
        logger.error(
          { err: err.message, userId: user.id, periodKey },
          'Evaluation failed for user — continuing'
        );
      }
    }

    await finalizePeriod(periodKey, {
      evaluatedCount: stats.evaluated,
      strikesIssuedCount: stats.strikesIssued,
      recoveriesAppliedCount: stats.recoveriesApplied,
    });

    await openNextPeriod(periodKey, { actorId });

    await audit({
      actorId,
      action: 'quota.period_evaluated',
      category: 'QUOTA',
      targetType: 'QuotaPeriod',
      targetId: locked.id,
      after: { periodKey, ...stats, dryRun },
    });

    logger.info({ periodKey, ...stats }, 'Quota period evaluated');
    return { status: 'EVALUATED', ...stats };
  } catch (err) {
    logger.error({ err: err.message, periodKey }, 'Quota evaluation failed');
    throw err;
  }
}

// ============================================================
//  Per-user evaluation
// ============================================================

async function evaluateOneUser({
  user,
  period,
  policyByCategory,
  onLeave,
  hasNotice,
  dryRun,
  onStrikeIssued,
}) {
  const category = user.quota_category;
  if (category !== 'STAFF' && category !== 'LOW_RANK') {
    return { strikeIssued: false, recoveriesApplied: 0 };
  }

  const policy = policyByCategory.get(category);
  if (!policy) return { strikeIssued: false, recoveriesApplied: 0 };

  // ---------- Exemption checks ----------
  const isExempt = evaluateExemption(user, period);
  const isOnLeave = onLeave.has(String(user.id));
  const hasExemptNotice = hasNotice.has(String(user.id));

  let actual = 0;
  let status = 'MISSED';
  let exemptReason = null;

  if (isExempt) {
    status = 'EXEMPT';
    exemptReason = 'MANUAL';
  } else if (isOnLeave) {
    status = 'EXEMPT';
    exemptReason = 'LEAVE';
  } else if (hasExemptNotice) {
    status = 'EXEMPT';
    exemptReason = 'NOTICE';
  } else {
    actual = await countMetric({ user, metric: policy.metric, period });
    status = actual >= policy.amount ? 'MET' : 'MISSED';
  }

  // ---------- Idempotency anchor ----------
  const { created, row: result } = await quotaResultRepo.ensureResult({
    periodId: period.id,
    periodKey: period.periodKey,
    userId: user.id,
    discordId: user.discord_id,
    category,
    metric: policy.metric,
    requiredAmount: policy.amount,
    actualAmount: actual,
    status,
    exemptReason,
  });

  if (!created) {
    return { strikeIssued: false, recoveriesApplied: 0 };
  }

  if (status === 'EXEMPT') {
    return { strikeIssued: false, recoveriesApplied: 0 };
  }

  if (status === 'MET') {
    const threshold = policy.recoveryMultiplier * policy.amount;
    const recoveries = threshold > 0 ? Math.floor(actual / threshold) : 0;

    if (recoveries > 0 && !dryRun) {
      const applied = await applyRecoveries({
        user,
        period,
        count: recoveries,
      });
      if (applied > 0) {
        await quotaResultRepo.markRecoveriesApplied(
          user.id,
          period.id,
          category,
          applied
        );
        return { strikeIssued: false, recoveriesApplied: applied };
      }
    }
    return { strikeIssued: false, recoveriesApplied: 0 };
  }

  if (status === 'MISSED') {
    if (dryRun) return { strikeIssued: false, recoveriesApplied: 0 };

    const { created: strikeCreated, row: strike } = await strikeRepo.ensureQuotaStrike({
      userId: user.id,
      discordId: user.discord_id,
      quotaPeriodKey: period.periodKey,
      reason:
        'Missed ' + category + ' quota: required ' + policy.amount + ' ' +
        policy.metric + ', achieved ' + actual + '.',
    });

    if (strikeCreated) {
      await quotaResultRepo.markStrikeIssued(user.id, period.id, category);

      if (typeof onStrikeIssued === 'function') {
        try {
          await onStrikeIssued({ user, strike, period });
        } catch (err) {
          logger.warn({ err: err.message }, 'onStrikeIssued callback failed');
        }
      }

      return { strikeIssued: true, recoveriesApplied: 0 };
    }

    return { strikeIssued: false, recoveriesApplied: 0 };
  }

  return { strikeIssued: false, recoveriesApplied: 0 };
}

// ============================================================
//  Helpers
// ============================================================

async function countMetric({ user, metric, period }) {
  if (metric === 'HOSTED_EVENTS') {
    return eventRepo.countApprovedByHostInRange(user.discord_id, {
      from: period.start_at,
      to: period.end_at,
    });
  }
  if (metric === 'ATTENDED_EVENTS') {
    return attendanceRepo.countActiveForUserInRange(user.id, {
      from: period.start_at,
      to: period.end_at,
    });
  }
  throw new Error('Unknown metric: ' + metric);
}

function evaluateExemption(user, period) {
  if (!user.quota_exempt) return false;
  const until = user.quota_exempt_until;
  if (!until) return true;
  return new Date(until) > new Date(period.end_at);
}

async function applyRecoveries({ user, period, count }) {
  let applied = 0;
  while (applied < count) {
    const strike = await strikeRepo.recoverOldestAtomic(user.id, {
      resolvedBy: 'system:quota-recovery',
      reason: 'Recovered via double-quota in ' + period.periodKey + '.',
      periodKey: period.periodKey,
    });
    if (!strike) break;
    applied++;
  }
  return applied;
}
import {
  User,
  Leave,
  Event,
  QuotaResult,
  QuotaPeriod,
  Strike,
} from '../models/index.js';
import { audit } from '../utils/audit.js';
import {
  getPeriodByKey,
  acquireClosingLock,
  finalizePeriod,
  openNextPeriod,
} from './quotaPeriod.service.js';
import { countAttendanceForUser } from './attendance.service.js';
import logger from '../config/logger.js';

/**
 * Weekly quota evaluation.
 *
 * Idempotency chain (no transactions):
 *   1. acquireClosingLock(key) — CAS: OPEN → CLOSING.
 *      If null, another worker is evaluating. Return early.
 *   2. For each user:
 *      a. QuotaResult.updateOne(..., { upsert: true }) — one row per
 *         (user, period, category).
 *      b. Only the caller who created the row (upsertedCount === 1)
 *         issues a strike or applies recovery.
 *   3. Strike partial-unique (user, quotaPeriodKey, type) — the DB
 *      refuses a duplicate strike even if (a) and (b) both misfire.
 *
 * Strike issuance is delegated to strikeService, imported lazily so
 * tests can mock it. Phase 10 provides the real implementation.
 */

let strikeService = null;
async function getStrikeService() {
  if (!strikeService) {
    strikeService = await import('./strike.service.js');
  }
  return strikeService;
}

const MAX_PERIOD_RESULTS = 100_000; // sanity cap

// ============================================================
//  Public entry point
// ============================================================

/**
 * Evaluate a quota period by its key.
 *
 * @param {string} periodKey    e.g. "2026-W41"
 * @param {object} opts
 * @param {string} [opts.actorId]  "system" or a discordId
 * @param {boolean}[opts.dryRun]   if true, do not issue strikes/recoveries
 * @returns {Promise<{status, evaluated, strikesIssued, recoveriesApplied, skipped}>}
 */
export async function evaluatePeriod(periodKey, { actorId = 'system', dryRun = false, onStrikeIssued = null } = {}) {
  const period = await getPeriodByKey(periodKey);

  if (period.status === 'CLOSED') {
    logger.info({ periodKey }, 'Period already CLOSED — skipping');
    return { status: 'ALREADY_CLOSED', evaluated: 0, strikesIssued: 0, recoveriesApplied: 0, skipped: 0 };
  }

  // CAS: OPEN → CLOSING. If someone else got here first, exit.
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

    // Fetch eligible users. category ∈ {STAFF, LOW_RANK}, status ACTIVE.
    const eligible = await User.find({
      status: 'ACTIVE',
      'quota.category': { $in: ['STAFF', 'LOW_RANK'] },
    })
      .select('_id discordId quota roblox')
      .lean();

    if (eligible.length > MAX_PERIOD_RESULTS) {
      logger.warn(
        { periodKey, eligible: eligible.length },
        'Eligible user count exceeds sanity cap — proceeding anyway'
      );
    }

    // Pre-fetch leaves overlapping the period once.
    const overlappingLeaves = await Leave.find({
      status: 'APPROVED',
      startAt: { $lt: locked.endAt },
      endAt: { $gt: locked.startAt },
    })
      .select('user')
      .lean();
    const onLeave = new Set(overlappingLeaves.map((l) => String(l.user)));

    for (const user of eligible) {
      try {
        const result = await evaluateOneUser({
          user,
          period: locked,
          policyByCategory,
          onLeave,
          dryRun,
          onStrikeIssued,
        });
        stats.evaluated++;
        stats.strikesIssued += result.strikeIssued ? 1 : 0;
        stats.recoveriesApplied += result.recoveriesApplied || 0;
      } catch (err) {
        stats.skipped++;
        logger.error(
          { err: err.message, userId: String(user._id), periodKey },
          'Evaluation failed for user — continuing'
        );
      }
    }

    // Finalize.
    await finalizePeriod(periodKey, {
      evaluatedCount: stats.evaluated,
      strikesIssuedCount: stats.strikesIssued,
      recoveriesAppliedCount: stats.recoveriesApplied,
    });

    // Open the next period.
    await openNextPeriod(periodKey, { actorId });

    await audit({
      actorId,
      action: 'quota.period_evaluated',
      category: 'QUOTA',
      targetType: 'QuotaPeriod',
      targetId: locked._id,
      after: { periodKey, ...stats, dryRun },
    });

    logger.info({ periodKey, ...stats }, 'Quota period evaluated');

    return { status: 'EVALUATED', ...stats };
  } catch (err) {
    // If we bailed, we might have left the period in CLOSING.
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
  dryRun,
}) {
  const category = user.quota?.category;
  if (category !== 'STAFF' && category !== 'LOW_RANK') {
    return { strikeIssued: false, recoveriesApplied: 0 };
  }

  const policy = policyByCategory.get(category);
  if (!policy) {
    // No policy for this category — nothing to evaluate.
    return { strikeIssued: false, recoveriesApplied: 0 };
  }

  // ---------- Exemption checks ----------
  const isExempt = evaluateExemption(user, period);
  const isOnLeave = onLeave.has(String(user._id));

  // ---------- Metric ----------
  let actual = 0;
  let status = 'MISSED';
  let exemptReason = null;

  if (isExempt || isOnLeave) {
    status = 'EXEMPT';
    exemptReason = isExempt ? 'MANUAL' : 'LEAVE';
  } else {
    actual = await countMetric({
      user,
      metric: policy.metric,
      period,
    });
    status = actual >= policy.amount ? 'MET' : 'MISSED';
  }

  // ---------- Idempotency anchor ----------
  // Upsert: only the caller who created the row proceeds to strike/recovery.
  const upsertResult = await QuotaResult.updateOne(
    { user: user._id, period: period._id, category },
    {
      $setOnInsert: {
        period: period._id,
        periodKey: period.periodKey,
        user: user._id,
        discordId: user.discordId,
        category,
        metric: policy.metric,
        required: policy.amount,
        actual,
        status,
        exemptReason,
        strikeIssued: false,
        recoveryApplied: false,
        recoveriesCount: 0,
        evaluatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  const weCreatedRow = upsertResult.upsertedCount === 1;

  if (!weCreatedRow) {
    // Someone already evaluated this user for this period.
    return { strikeIssued: false, recoveriesApplied: 0 };
  }

  // ---------- Strikes / recoveries ----------

  if (status === 'EXEMPT') {
    return { strikeIssued: false, recoveriesApplied: 0 };
  }

  if (status === 'MET') {
    // Recovery: floor(actual / (2 * required)).
    const threshold = policy.recoveryMultiplier * policy.amount;
    const recoveries = threshold > 0 ? Math.floor(actual / threshold) : 0;
    if (recoveries > 0 && !dryRun) {
      const applied = await applyRecoveries({
        user,
        period,
        count: recoveries,
      });
      if (applied > 0) {
        await QuotaResult.updateOne(
          { user: user._id, period: period._id, category },
          {
            $set: {
              recoveryApplied: true,
              recoveriesCount: applied,
            },
          }
        );
        return { strikeIssued: false, recoveriesApplied: applied };
      }
    }
    return { strikeIssued: false, recoveriesApplied: 0 };
  }

  if (status === 'MISSED') {
    if (dryRun) return { strikeIssued: false, recoveriesApplied: 0 };

    // Issue one strike. strikeService is idempotent via partial-unique.
    const { issueQuotaStrike } = await getStrikeService();
    const result = await issueQuotaStrike({
      user,
      period,
      reason: `Missed ${category} quota: required ${policy.amount} ${policy.metric}, achieved ${actual}.`,
    });

    if (result.created) {
      await QuotaResult.updateOne(
        { user: user._id, period: period._id, category },
        { $set: { strikeIssued: true } }
      );

      // Fire the notification hook (if provided) so the caller can DM.
      if (typeof onStrikeIssued === 'function') {
        try {
          await onStrikeIssued({ user, strike: result.strike, period });
        } catch (err) {
          logger.warn({ err: err.message }, 'onStrikeIssued callback failed');
        }
      }

      return { strikeIssued: true, recoveriesApplied: 0 };
    }

    // Strike already existed (idempotent path).
    return { strikeIssued: false, recoveriesApplied: 0 };
  }

  return { strikeIssued: false, recoveriesApplied: 0 };
}

// ============================================================
//  Helpers
// ============================================================

/**
 * Count the metric for a user in the given period.
 * Returns an integer.
 */
async function countMetric({ user, metric, period }) {
  if (metric === 'HOSTED_EVENTS') {
    return Event.countDocuments({
      'host.discordId': user.discordId,
      status: 'APPROVED',
      cooldownAnchor: { $gte: period.startAt, $lt: period.endAt },
    });
  }
  if (metric === 'ATTENDED_EVENTS') {
    return countAttendanceForUser(user._id, {
      from: period.startAt,
      to: period.endAt,
    });
  }
  throw new Error(`Unknown metric: ${metric}`);
}

/**
 * Effective exemption check (D4).
 * - `quota.exempt === true`
 * - AND (`quota.exemptUntil === null` OR `quota.exemptUntil > period.endAt`)
 *
 * We compare against `period.endAt`, not now, so an exemption that
 * expires mid-week still exempts the whole week (D4).
 */
function evaluateExemption(user, period) {
  if (!user.quota?.exempt) return false;
  const until = user.quota?.exemptUntil;
  if (!until) return true;
  return new Date(until) > new Date(period.endAt);
}

/**
 * Apply `count` recoveries to the user's ACTIVE strikes (oldest first).
 * Returns the number actually applied.
 *
 * Idempotent per (strike, period): the same strike cannot be recovered
 * twice in the same period because we filter on `status: 'ACTIVE'`.
 */
async function applyRecoveries({ user, period, count }) {
  let applied = 0;
  while (applied < count) {
    const strike = await Strike.findOneAndUpdate(
      { user: user._id, status: 'ACTIVE' },
      {
        $set: {
          status: 'RECOVERED',
          resolvedAt: new Date(),
          resolvedBy: 'system:quota-recovery',
          recoveredInPeriodKey: period.periodKey,
          resolutionReason: `Recovered via double-quota in ${period.periodKey}.`,
        },
      },
      { sort: { issuedAt: 1 }, new: true }
    );
    if (!strike) break;
    applied++;
  }
  return applied;
}
import {
  Strike,
  User,
  Settings,
} from '../models/index.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Strike service.
 *
 * Owns every write path for the Strike collection. Every mutation is
 * audited. Idempotency:
 *
 *   - Quota-driven strikes use `uniq_quota_strike_per_user_period`,
 *     a partial-unique index on (user, quotaPeriodKey, type=QUOTA_MISSED).
 *     A second issuance for the same period returns { created: false }
 *     rather than throwing.
 *
 *   - Manual strikes have no unique constraint. Two manual strikes can
 *     coexist, which is intentional (staff may issue more than one for
 *     distinct reasons).
 *
 *   - Removal/cancellation operations are terminal transitions on the
 *     `status` field. Re-running them is a no-op.
 *
 * Threshold check (§25): after every successful issue we recount ACTIVE
 * strikes and, if the count reaches `settings.strikes.removalThreshold`,
 * we call removalRequestService.createFromThreshold. This is
 * idempotent thanks to RemovalRequest's own partial-unique index.
 */

// ============================================================
//  Issuance
// ============================================================

/**
 * Issue a strike for a missed quota period.
 *
 * Idempotent: re-issuing for the same (user, period) returns
 * { created: false, strike: <existing> }.
 *
 * Always calls checkThresholdAndCreateRemoval on successful creation.
 */
export async function issueQuotaStrike({ user, period, reason }) {
  if (!user?._id || !period?.periodKey) {
    throw new ValidationError('issueQuotaStrike requires user and period.');
  }

  // Pre-check: does a QUOTA_MISSED strike already exist for this (user, period)?
  const existing = await Strike.findOne({
    user: user._id,
    quotaPeriodKey: period.periodKey,
    type: 'QUOTA_MISSED',
  }).lean();
  if (existing) {
    return { created: false, strike: existing };
  }

  // Try to create. The partial-unique index protects against a race.
  try {
    const strike = await Strike.create({
      user: user._id,
      discordId: user.discordId,
      type: 'QUOTA_MISSED',
      quotaPeriodKey: period.periodKey,
      reason: reason || `Missed quota for period ${period.periodKey}.`,
      issuedBy: 'system',
      status: 'ACTIVE',
    });

    await audit({
      actorId: 'system',
      action: 'strike.issued',
      category: 'STRIKE',
      targetType: 'Strike',
      targetId: strike._id,
      after: {
        userId: String(user._id),
        discordId: user.discordId,
        type: 'QUOTA_MISSED',
        quotaPeriodKey: period.periodKey,
      },
    });

    logger.info(
      { strikeId: String(strike._id), discordId: user.discordId, period: period.periodKey },
      'Quota strike issued'
    );

    await checkThresholdAndCreateRemoval(user);

    return { created: true, strike: strike.toObject() };
  } catch (err) {
    if (err.code === 11000) {
      const winner = await Strike.findOne({
        user: user._id,
        quotaPeriodKey: period.periodKey,
        type: 'QUOTA_MISSED',
      }).lean();
      return { created: false, strike: winner };
    }
    throw err;
  }
}

/**
 * Issue a manual strike.
 * Requires a reason. Not idempotent — each call creates a new row.
 */
export async function issueManualStrike(actorId, {
  targetDiscordId,
  reason,
} = {}) {
  if (!targetDiscordId) throw new ValidationError('targetDiscordId is required.');
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required for a manual strike.');
  }

  const user = await User.findOne({ discordId: targetDiscordId });
  if (!user) throw new NotFoundError('User', { discordId: targetDiscordId });

  const strike = await Strike.create({
    user: user._id,
    discordId: user.discordId,
    type: 'MANUAL',
    quotaPeriodKey: null,
    reason: reason.trim(),
    issuedBy: actorId,
    status: 'ACTIVE',
  });

  await audit({
    actorId,
    action: 'strike.manual_issued',
    category: 'STRIKE',
    targetType: 'Strike',
    targetId: strike._id,
    after: {
      userId: String(user._id),
      discordId: user.discordId,
      type: 'MANUAL',
    },
    reason: reason.trim(),
  });

  logger.info(
    { strikeId: String(strike._id), discordId: user.discordId, actorId },
    'Manual strike issued'
  );

  await checkThresholdAndCreateRemoval(user);

  return strike;
}

// ============================================================
//  Removal / recovery
// ============================================================

/**
 * Cancel an ACTIVE strike manually.
 * Idempotent: cancelling a non-ACTIVE strike is a no-op.
 */
export async function removeStrike(actorId, strikeId, { reason = null } = {}) {
  const strike = await Strike.findById(strikeId);
  if (!strike) throw new NotFoundError('Strike', { id: String(strikeId) });
  if (strike.status !== 'ACTIVE') {
    return { removed: false, strike: strike.toObject() };
  }

  strike.status = 'CANCELLED';
  strike.resolvedAt = new Date();
  strike.resolvedBy = actorId;
  strike.resolutionReason = reason;
  await strike.save();

  await audit({
    actorId,
    action: 'strike.removed',
    category: 'STRIKE',
    targetType: 'Strike',
    targetId: strike._id,
    before: { status: 'ACTIVE' },
    after: { status: 'CANCELLED' },
    reason,
  });

  return { removed: true, strike: strike.toObject() };
}

/**
 * Manually recover a strike (per D7 this is usually done automatically
 * by quota evaluation, but High Command may also do it).
 * Idempotent: recovering a non-ACTIVE strike is a no-op.
 */
export async function recoverStrike(actorId, strikeId, {
  reason = null,
  periodKey = null,
} = {}) {
  const strike = await Strike.findById(strikeId);
  if (!strike) throw new NotFoundError('Strike', { id: String(strikeId) });
  if (strike.status !== 'ACTIVE') {
    return { recovered: false, strike: strike.toObject() };
  }

  strike.status = 'RECOVERED';
  strike.resolvedAt = new Date();
  strike.resolvedBy = actorId;
  strike.resolutionReason = reason;
  strike.recoveredInPeriodKey = periodKey;
  await strike.save();

  await audit({
    actorId,
    action: 'strike.recovered',
    category: 'STRIKE',
    targetType: 'Strike',
    targetId: strike._id,
    before: { status: 'ACTIVE' },
    after: { status: 'RECOVERED', recoveredInPeriodKey: periodKey },
    reason,
  });

  return { recovered: true, strike: strike.toObject() };
}

/**
 * Reset all ACTIVE strikes for a user on rejoin (D10).
 * Sets status to CANCELLED with a distinct resolutionReason.
 * Never deletes rows — historical records preserved.
 */
export async function resetStrikesOnRejoin(actorId, targetDiscordId) {
  const user = await User.findOne({ discordId: targetDiscordId });
  if (!user) throw new NotFoundError('User', { discordId: targetDiscordId });

  const active = await Strike.find({ user: user._id, status: 'ACTIVE' });
  if (active.length === 0) return { reset: 0 };

  const now = new Date();
  for (const strike of active) {
    strike.status = 'CANCELLED';
    strike.resolvedAt = now;
    strike.resolvedBy = actorId;
    strike.resolutionReason = 'rejoin reset (D10)';
    await strike.save();
  }

  await audit({
    actorId,
    action: 'strike.reset_on_rejoin',
    category: 'STRIKE',
    targetType: 'User',
    targetId: user._id,
    before: { activeStrikes: active.length },
    after: { activeStrikes: 0 },
  });

  logger.info({ discordId: targetDiscordId, reset: active.length }, 'Strikes reset on rejoin');
  return { reset: active.length };
}

// ============================================================
//  Reads
// ============================================================

export async function getActiveStrikes(discordId) {
  return Strike.find({ discordId, status: 'ACTIVE' })
    .sort({ issuedAt: 1 })
    .lean();
}

export async function getStrikeHistory(discordId, { limit = 50 } = {}) {
  return Strike.find({ discordId })
    .sort({ issuedAt: -1 })
    .limit(Math.min(200, Math.max(1, Number(limit) || 50)))
    .lean();
}

export async function countActiveStrikes(discordId) {
  return Strike.countDocuments({ discordId, status: 'ACTIVE' });
}

// ============================================================
//  Threshold → removal request
// ============================================================

/**
 * After a strike is issued, check whether the user has reached the
 * threshold. If so, create a pending removal request.
 *
 * Idempotent via RemovalRequest's partial-unique index on
 * (user, status: 'PENDING').
 *
 * Imported lazily to avoid a circular dependency (removal service
 * imports strike service for the count).
 */
async function checkThresholdAndCreateRemoval(user) {
  const settings = await Settings.findOne({ key: 'global' }).lean();
  const threshold = settings?.strikes?.removalThreshold ?? 3;

  const activeCount = await Strike.countDocuments({ user: user._id, status: 'ACTIVE' });
  if (activeCount < threshold) return null;

  const { createFromThreshold } = await import('./removalRequest.service.js');
  const result = await createFromThreshold(user, {
    strikeCount: activeCount,
    strikeThreshold: threshold,
  });

  if (result.created) {
    logger.info(
      { discordId: user.discordId, activeCount, threshold },
      'Threshold reached — removal request created'
    );
  }
  return result;
}
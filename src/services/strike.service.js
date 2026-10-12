import * as strikeRepo from '../db/repositories/strike.repository.js';
import * as userRepo from '../db/repositories/user.repository.js';
import * as settingsRepo from '../db/repositories/settings.repository.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Strike service. Public API unchanged.
 *
 * Idempotency:
 *   - ensureQuotaStrike uses a pre-check for the unique
 *     (user_id, type='QUOTA_MISSED', quota_period_key) tuple.
 *   - cancelAtomic and recoverAtomic are status CAS operations.
 */

const DEFAULT_THRESHOLD = 3;

// ============================================================
//  Issuance
// ============================================================

export async function issueQuotaStrike({ user, period, reason }) {
  if (!user?.id || !period?.periodKey) {
    throw new ValidationError('issueQuotaStrike requires user and period.');
  }

  const { created, row: strike } = await strikeRepo.ensureQuotaStrike({
    userId: user.id,
    discordId: user.discord_id,
    quotaPeriodKey: period.periodKey,
    reason: reason || 'Missed quota for period ' + period.periodKey + '.',
    issuedBy: 'system',
  });

  if (created) {
    await audit({
      actorId: 'system',
      action: 'strike.issued',
      category: 'STRIKE',
      targetType: 'Strike',
      targetId: strike.id,
      after: {
        userId: String(user.id),
        discordId: user.discord_id,
        type: 'QUOTA_MISSED',
        quotaPeriodKey: period.periodKey,
      },
    });

    logger.info(
      { strikeId: strike.id, discordId: user.discord_id, period: period.periodKey },
      'Quota strike issued'
    );

    await checkThresholdAndCreateRemoval(user);
  }

  return { created, strike };
}

export async function issueManualStrike(actorId, {
  targetDiscordId,
  reason,
} = {}) {
  if (!targetDiscordId) throw new ValidationError('targetDiscordId is required.');
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required for a manual strike.');
  }

  const user = await userRepo.findByDiscordId(targetDiscordId);
  if (!user) throw new NotFoundError('User', { discordId: targetDiscordId });

  const strike = await strikeRepo.createManual({
    userId: user.id,
    discordId: user.discord_id,
    reason: reason.trim(),
    issuedBy: actorId,
  });

  await audit({
    actorId,
    action: 'strike.manual_issued',
    category: 'STRIKE',
    targetType: 'Strike',
    targetId: strike.id,
    after: {
      userId: String(user.id),
      discordId: user.discord_id,
      type: 'MANUAL',
    },
    reason: reason.trim(),
  });

  logger.info(
    { strikeId: strike.id, discordId: user.discord_id, actorId },
    'Manual strike issued'
  );

  await checkThresholdAndCreateRemoval(user);

  return strike;
}

// ============================================================
//  Removal / recovery
// ============================================================

export async function removeStrike(actorId, strikeId, { reason = null } = {}) {
  const existing = await strikeRepo.findById(strikeId);
  if (!existing) throw new NotFoundError('Strike', { id: String(strikeId) });

  if (existing.status !== 'ACTIVE') {
    return { removed: false, strike: existing };
  }

  const updated = await strikeRepo.cancelAtomic(strikeId, {
    resolvedBy: actorId,
    reason,
  });

  if (!updated) {
    const reloaded = await strikeRepo.findById(strikeId);
    return { removed: false, strike: reloaded };
  }

  await audit({
    actorId,
    action: 'strike.removed',
    category: 'STRIKE',
    targetType: 'Strike',
    targetId: updated.id,
    before: { status: 'ACTIVE' },
    after: { status: 'CANCELLED' },
    reason,
  });

  return { removed: true, strike: updated };
}

export async function recoverStrike(actorId, strikeId, {
  reason = null,
  periodKey = null,
} = {}) {
  const existing = await strikeRepo.findById(strikeId);
  if (!existing) throw new NotFoundError('Strike', { id: String(strikeId) });

  if (existing.status !== 'ACTIVE') {
    return { recovered: false, strike: existing };
  }

  const updated = await strikeRepo.recoverAtomic(strikeId, {
    resolvedBy: actorId,
    reason,
    periodKey,
  });

  if (!updated) {
    const reloaded = await strikeRepo.findById(strikeId);
    return { recovered: false, strike: reloaded };
  }

  await audit({
    actorId,
    action: 'strike.recovered',
    category: 'STRIKE',
    targetType: 'Strike',
    targetId: updated.id,
    before: { status: 'ACTIVE' },
    after: { status: 'RECOVERED', recoveredInPeriodKey: periodKey },
    reason,
  });

  return { recovered: true, strike: updated };
}

/**
 * Reset all ACTIVE strikes for a user on rejoin (D10).
 */
export async function resetStrikesOnRejoin(actorId, targetDiscordId) {
  const user = await userRepo.findByDiscordId(targetDiscordId);
  if (!user) throw new NotFoundError('User', { discordId: targetDiscordId });

  const active = await strikeRepo.listActiveForUser(targetDiscordId);
  if (active.length === 0) return { reset: 0 };

  await strikeRepo.cancelAllActiveForUser(user.id, {
    resolvedBy: actorId,
    reason: 'rejoin reset (D10)',
  });

  await audit({
    actorId,
    action: 'strike.reset_on_rejoin',
    category: 'STRIKE',
    targetType: 'User',
    targetId: user.id,
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
  return strikeRepo.listActiveForUser(discordId);
}

export async function getStrikeHistory(discordId, { limit = 50 } = {}) {
  return strikeRepo.historyForUser(discordId, { limit });
}

export async function countActiveStrikes(discordId) {
  return strikeRepo.countActiveForUser(discordId);
}

// ============================================================
//  Threshold → removal request
// ============================================================

async function checkThresholdAndCreateRemoval(user) {
  const thresholdRow = await settingsRepo.findByKey('strikes.removalThreshold');
  let threshold = DEFAULT_THRESHOLD;
  if (thresholdRow) {
    try {
      const parsed = JSON.parse(thresholdRow.value_json);
      if (typeof parsed === 'number') threshold = parsed;
    } catch {
      // keep default
    }
  }

  const activeCount = await strikeRepo.countActiveForUser(user.discord_id);
  if (activeCount < threshold) return null;

  const { createFromThreshold } = await import('./removalRequest.service.js');
  const result = await createFromThreshold(user, {
    strikeCount: activeCount,
    strikeThreshold: threshold,
  });

  if (result.created) {
    logger.info(
      { discordId: user.discord_id, activeCount, threshold },
      'Threshold reached — removal request created'
    );
  }
  return result;
}
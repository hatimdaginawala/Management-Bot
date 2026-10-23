import * as removalRepo from '../db/repositories/removalRequest.repository.js';
import * as userRepo from '../db/repositories/user.repository.js';
import * as roleAssignmentRepo from '../db/repositories/roleAssignment.repository.js';
import * as strikeRepo from '../db/repositories/strike.repository.js';
import * as settingsRepo from '../db/repositories/settings.repository.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';
import { REMOVAL_MIN_ADVANCE_DAYS } from '../config/constants.js';
import { db } from '../db/client.js';
import logger from '../config/logger.js';

const DEFAULT_THRESHOLD = 3;

// ============================================================
//  Strike-threshold removals (existing)
// ============================================================

export async function createFromThreshold(user, { strikeCount, strikeThreshold } = {}) {
  if (!user?.id) throw new ValidationError('createFromThreshold requires user.');

  const result = await db.transaction(async (trx) => {
    const existing = await removalRepo.findPendingForUser(user.id, trx);
    if (existing) return { created: false, request: existing };

    return removalRepo.ensurePending({
      userId: user.id,
      discordId: user.discord_id,
      reason: 'THRESHOLD',
      strikeCount: strikeCount ?? 0,
      strikeThreshold: strikeThreshold ?? 0,
      description:
        'Automatic removal request: reached ' + strikeCount +
        ' active strikes (threshold ' + strikeThreshold + ').',
    }, trx);
  });

  if (result.created) {
    await audit({
      actorId: 'system',
      action: 'removal.threshold_reached',
      category: 'REMOVAL',
      targetType: 'RemovalRequest',
      targetId: result.request.id,
      after: { discordId: user.discord_id, strikeCount, strikeThreshold },
    });
  }

  return result;
}

export async function createManual(actorId, { targetDiscordId, description } = {}) {
  if (!targetDiscordId) throw new ValidationError('targetDiscordId is required.');
  if (!description || description.trim().length < 3) {
    throw new ValidationError('A description is required for a manual removal.');
  }

  const user = await userRepo.findByDiscordId(targetDiscordId);
  if (!user) throw new NotFoundError('User', { discordId: targetDiscordId });

  const strikeCount = await strikeRepo.countActiveForUser(targetDiscordId);
  const thresholdRow = await settingsRepo.findByKey('strikes.removalThreshold');
  let threshold = DEFAULT_THRESHOLD;
  if (thresholdRow) {
    try {
      const parsed = JSON.parse(thresholdRow.value_json);
      if (typeof parsed === 'number') threshold = parsed;
    } catch {}
  }

  const request = await db.transaction(async (trx) => {
    const existing = await removalRepo.findPendingForUser(user.id, trx);
    if (existing) {
      throw new ConflictError('This user already has a PENDING removal request.');
    }
    return removalRepo.createManual({
      userId: user.id,
      discordId: user.discord_id,
      reason: 'ADMIN',
      strikeCount,
      strikeThreshold: threshold,
      description: description.trim(),
    }, trx);
  });

  await audit({
    actorId,
    action: 'removal.manual_created',
    category: 'REMOVAL',
    targetType: 'RemovalRequest',
    targetId: request.id,
    after: { discordId: targetDiscordId, strikeCount, reason: 'ADMIN' },
    reason: description.trim(),
  });

  return request;
}

// ============================================================
//  Voluntary departures (NEW)
// ============================================================

export async function createVoluntary(actorId, {
  reason,
  effectiveAt = null,
} = {}) {
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required (min 3 characters).');
  }

  const user = await userRepo.findByDiscordId(actorId);
  if (!user) throw new NotFoundError('User', { discordId: actorId });

  const request = await db.transaction(async (trx) => {
    const existing = await removalRepo.findPendingForUser(user.id, trx);
    if (existing) {
      throw new ConflictError(
        'You already have a pending removal or departure request. Contact High Command.'
      );
    }
    return removalRepo.createManual({
      userId: user.id,
      discordId: user.discord_id,
      reason: 'VOLUNTARY',
      strikeCount: 0,
      strikeThreshold: 0,
      description: reason.trim(),
    }, trx);
  });

  await audit({
    actorId,
    action: 'removal.voluntary_requested',
    category: 'REMOVAL',
    targetType: 'RemovalRequest',
    targetId: request.id,
    after: { discordId: actorId, reason: reason.trim() },
    reason: reason.trim(),
  });

  logger.info({ discordId: actorId, requestId: request.id }, 'Voluntary departure requested');
  return request;
}

// ============================================================
//  Review
// ============================================================

export async function approveRemoval(actorId, requestId, {
  reason = null,
  effectiveAt = null,
  client = null,
} = {}) {
  const existingRequest = await removalRepo.findById(requestId);
  if (!existingRequest) {
    throw new NotFoundError('RemovalRequest', { id: String(requestId) });
  }

  // For voluntary departures, allow immediate effective date.
  // For everything else, enforce the 3-day minimum.
  const isVoluntary = existingRequest.reason === 'VOLUNTARY';
  const minDate = isVoluntary ? new Date() : new Date(Date.now() + REMOVAL_MIN_ADVANCE_DAYS * 86_400_000);
  const targetDate = effectiveAt ? new Date(effectiveAt) : minDate;

  if (Number.isNaN(targetDate.getTime())) {
    throw new ValidationError('effectiveAt must be a valid date.');
  }
  if (targetDate < minDate) {
    throw new ValidationError(
      isVoluntary
        ? 'effectiveAt must not be in the past.'
        : 'effectiveAt must be at least ' + REMOVAL_MIN_ADVANCE_DAYS + ' days in the future.'
    );
  }

  const result = await db.transaction(async (trx) => {
    const request = await removalRepo.approveAtomic(requestId, {
      reviewedBy: actorId,
      reason,
      removalEffectiveAt: targetDate,
    });

    if (!request) {
      const existing = await removalRepo.findById(requestId);
      if (!existing) throw new NotFoundError('RemovalRequest', { id: String(requestId) });
      throw new ConflictError('Cannot approve removal with status ' + existing.status + '.');
    }

    const user = await userRepo.findById(request.user_id);
    if (user) {
      await userRepo.updateById(user.id, {
        status: 'SUSPENDED',
        suspendedAt: new Date(),
        suspensionReason:
          'Removal approved by ' + actorId + '. Effective ' + targetDate.toISOString() + '.',
      });
    }

    return request;
  });

  await audit({
    actorId,
    action: 'removal.approved',
    category: 'REMOVAL',
    targetType: 'RemovalRequest',
    targetId: result.id,
    after: {
      status: 'APPROVED',
      removalEffectiveAt: targetDate,
      userStatus: 'SUSPENDED',
      reason: existingRequest.reason,
    },
    reason,
  });

  logger.info(
    { requestId: result.id, effectiveAt: targetDate, actorId },
    'Removal approved'
  );

  return result;
}

export async function dismissRemoval(actorId, requestId, { reason = null, client = null } = {}) {
  const request = await removalRepo.dismissAtomic(requestId, {
    reviewedBy: actorId,
    reason,
  });

  if (!request) {
    const existing = await removalRepo.findById(requestId);
    if (!existing) throw new NotFoundError('RemovalRequest', { id: String(requestId) });
    throw new ConflictError('Cannot dismiss removal with status ' + existing.status + '.');
  }

  await audit({
    actorId,
    action: 'removal.dismissed',
    category: 'REMOVAL',
    targetType: 'RemovalRequest',
    targetId: request.id,
    after: { status: 'DISMISSED' },
    reason,
  });

  return request;
}

// ============================================================
//  Scheduled-job helpers
// ============================================================

export async function findDueRemovals(asOf = new Date()) {
  return removalRepo.findDueForApplication(asOf);
}

export async function applyRemoval(requestId, { actorId = 'system' } = {}) {
  const result = await db.transaction(async (trx) => {
    const request = await removalRepo.markAppliedAtomic(requestId, trx);
    if (!request) return { applied: false };

    const user = await userRepo.findById(request.user_id);
    if (!user) return { applied: false, missingUser: true };

    // 1. Status → LEFT_ROBLOX_GROUP
    await userRepo.updateById(user.id, {
      status: 'LEFT_ROBLOX_GROUP',
      lastLeftRobloxAt: new Date(),
    });

    // 2. Unassign all internal roles
    const activeAssignments = await roleAssignmentRepo.findActiveForUser(user.id);
    const unassignedKeys = [];
    for (const a of activeAssignments) {
      await roleAssignmentRepo.deactivate(user.id, a.role_id, {
        removedBy: actorId,
        reason: 'Removal applied',
      });
      unassignedKeys.push(a.role_key);
    }

    // 3. Quota category → NONE
    await userRepo.updateById(user.id, { quotaCategory: 'NONE' });

    // 4. Cancel all active strikes
    const activeStrikes = await strikeRepo.listActiveForUser(user.discord_id);
    const cancelledStrikes = await strikeRepo.cancelAllActiveForUser(user.id, {
      resolvedBy: actorId,
      reason: 'User left the group',
    });

    return {
      applied: true,
      user: { ...user, status: 'LEFT_ROBLOX_GROUP', quota_category: 'NONE' },
      unassignedRoles: unassignedKeys,
      cancelledStrikes,
      requestReason: request.reason,
    };
  });

  if (result.applied) {
    await audit({
      actorId,
      action: 'removal.applied',
      category: 'REMOVAL',
      targetType: 'RemovalRequest',
      targetId: requestId,
      after: {
        userStatus: 'LEFT_ROBLOX_GROUP',
        unassignedRoles: result.unassignedRoles,
        cancelledStrikes: result.cancelledStrikes,
        requestReason: result.requestReason,
      },
    });

    logger.info(
      {
        requestId,
        discordId: result.user?.discord_id,
        unassignedRoles: result.unassignedRoles,
        cancelledStrikes: result.cancelledStrikes,
        reason: result.requestReason,
      },
      'Removal applied'
    );
  }

  return result;
}

// ============================================================
//  Reads
// ============================================================

export async function listPendingRemovals({ page = 1, pageSize = 25, reason = null } = {}) {
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));

  const { items, total } = await removalRepo.listPending({ page, pageSize, reason });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getRemovalById(requestId) {
  const r = await removalRepo.findById(requestId);
  if (!r) throw new NotFoundError('RemovalRequest', { id: String(requestId) });
  return r;
}

export async function getPendingForUser(discordId) {
  const user = await userRepo.findByDiscordId(discordId);
  if (!user) return null;
  return removalRepo.findPendingForUser(user.id);
}
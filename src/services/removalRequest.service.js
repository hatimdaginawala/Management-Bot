import {
  RemovalRequest,
  User,
  RoleAssignment,
  Strike,
  Settings,
} from '../models/index.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  AuthorizationError,
} from '../utils/errors.js';
import { REMOVAL_MIN_ADVANCE_DAYS } from '../config/constants.js';
import logger from '../config/logger.js';

/**
 * Removal request service.
 *
 * Lifecycle (§26, D8):
 *
 *   PENDING  → created when a user reaches the strike threshold, OR
 *              created manually by High Command.
 *   APPROVED → reviewer sets a `removalEffectiveAt` at least
 *              REMOVAL_MIN_ADVANCE_DAYS in the future. User's status
 *              becomes SUSPENDED immediately. A scheduled job (Phase 17)
 *              later flips to LEFT_ROBLOX_GROUP and unassigns roles.
 *   DISMISSED → strikes persist (D5).
 *   CANCELLED → manual cancellation by the creator.
 *
 * Idempotency:
 *   - Partial-unique on (user, status: 'PENDING') prevents duplicate
 *     pending requests for the same user.
 *   - Explicit pre-checks inside createFromThreshold and createManual
 *     defend against the case where the index isn't yet built.
 *   - approveRemoval is CAS (`status: 'PENDING'` → `'APPROVED'`).
 *   - dismissRemoval is CAS.
 *   - applyEffectiveRemovals filters on `status: 'APPROVED', appliedAt: null`.
 */

// ============================================================
//  Creation
// ============================================================

/**
 * Create a PENDING removal request from the strike threshold.
 * Idempotent — re-calling for the same user while a PENDING
 * request exists returns { created: false }.
 */
export async function createFromThreshold(user, {
  strikeCount,
  strikeThreshold,
} = {}) {
  if (!user?._id) throw new ValidationError('createFromThreshold requires user.');

  // Explicit pre-check for clarity (index also protects).
  const existing = await RemovalRequest.findOne({
    user: user._id,
    status: 'PENDING',
  });
  if (existing) return { created: false, request: existing.toObject() };

  try {
    const request = await RemovalRequest.create({
      user: user._id,
      discordId: user.discordId,
      reason: 'THRESHOLD',
      strikeCount: strikeCount ?? 0,
      strikeThreshold: strikeThreshold ?? 0,
      description: `Automatic removal request: reached ${strikeCount} active strikes (threshold ${strikeThreshold}).`,
      status: 'PENDING',
    });

    await audit({
      actorId: 'system',
      action: 'removal.threshold_reached',
      category: 'REMOVAL',
      targetType: 'RemovalRequest',
      targetId: request._id,
      after: {
        discordId: user.discordId,
        strikeCount,
        strikeThreshold,
      },
    });

    return { created: true, request: request.toObject() };
  } catch (err) {
    if (err.code === 11000) {
      const winner = await RemovalRequest.findOne({
        user: user._id,
        status: 'PENDING',
      }).lean();
      return { created: false, request: winner };
    }
    throw err;
  }
}

/**
 * Manually create a removal request (High Command only, gated at the
 * command layer via `removal.approve`).
 */
export async function createManual(actorId, {
  targetDiscordId,
  description,
} = {}) {
  if (!targetDiscordId) throw new ValidationError('targetDiscordId is required.');
  if (!description || description.trim().length < 3) {
    throw new ValidationError('A description is required for a manual removal.');
  }

  const user = await User.findOne({ discordId: targetDiscordId });
  if (!user) throw new NotFoundError('User', { discordId: targetDiscordId });

  // Explicit pre-check — belt and suspenders for the case where the
  // partial-unique index isn't yet built (e.g. first boot before
  // ensureIndexes completes, or a fresh in-memory MongoDB in tests).
  const existing = await RemovalRequest.findOne({
    user: user._id,
    status: 'PENDING',
  });
  if (existing) {
    throw new ConflictError(
      'This user already has a PENDING removal request.'
    );
  }

  const strikeCount = await Strike.countDocuments({ user: user._id, status: 'ACTIVE' });
  const settings = await Settings.findOne({ key: 'global' }).lean();
  const threshold = settings?.strikes?.removalThreshold ?? 3;

  try {
    const request = await RemovalRequest.create({
      user: user._id,
      discordId: user.discordId,
      reason: 'MANUAL',
      strikeCount,
      strikeThreshold: threshold,
      description: description.trim(),
      status: 'PENDING',
    });

    await audit({
      actorId,
      action: 'removal.manual_created',
      category: 'REMOVAL',
      targetType: 'RemovalRequest',
      targetId: request._id,
      after: { discordId: targetDiscordId, strikeCount },
      reason: description.trim(),
    });

    return request.toObject();
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError(
        'This user already has a PENDING removal request.'
      );
    }
    throw err;
  }
}

// ============================================================
//  Review
// ============================================================

/**
 * Approve a pending removal request.
 *
 * `effectiveAt` must be ≥ now + REMOVAL_MIN_ADVANCE_DAYS (D8).
 * Defaults to now + REMOVAL_MIN_ADVANCE_DAYS if not provided.
 * Sets user's status to SUSPENDED. The scheduled job (Phase 17) is
 * responsible for the subsequent LEFT_ROBLOX_GROUP transition and
 * role unassignment.
 */
export async function approveRemoval(actorId, requestId, {
  reason = null,
  effectiveAt = null,
} = {}) {
  const minDate = new Date(Date.now() + REMOVAL_MIN_ADVANCE_DAYS * 86_400_000);
  const targetDate = effectiveAt ? new Date(effectiveAt) : minDate;

  if (Number.isNaN(targetDate.getTime())) {
    throw new ValidationError('effectiveAt must be a valid date.');
  }
  if (targetDate < minDate) {
    throw new ValidationError(
      `effectiveAt must be at least ${REMOVAL_MIN_ADVANCE_DAYS} days in the future.`
    );
  }

  // CAS: PENDING → APPROVED.
  const request = await RemovalRequest.findOneAndUpdate(
    { _id: requestId, status: 'PENDING' },
    {
      $set: {
        status: 'APPROVED',
        reviewedBy: actorId,
        reviewedAt: new Date(),
        reviewReason: reason,
        removalEffectiveAt: targetDate,
      },
    },
    { new: true }
  );

  if (!request) {
    const existing = await RemovalRequest.findById(requestId);
    if (!existing) throw new NotFoundError('RemovalRequest', { id: String(requestId) });
    throw new ConflictError(
      `Cannot approve removal with status ${existing.status}.`
    );
  }

  // Immediately set the user to SUSPENDED.
  const user = await User.findById(request.user);
  if (user) {
    user.status = 'SUSPENDED';
    user.suspendedAt = new Date();
    user.suspensionReason = `Removal approved by ${actorId}. Effective ${targetDate.toISOString()}.`;
    await user.save();
  }

  await audit({
    actorId,
    action: 'removal.approved',
    category: 'REMOVAL',
    targetType: 'RemovalRequest',
    targetId: request._id,
    after: {
      status: 'APPROVED',
      removalEffectiveAt: targetDate,
      userStatus: 'SUSPENDED',
    },
    reason,
  });

  logger.info(
    { requestId: String(request._id), effectiveAt: targetDate, actorId },
    'Removal approved'
  );

  return request.toObject();
}

/**
 * Dismiss a pending removal request (D5: strikes persist).
 */
export async function dismissRemoval(actorId, requestId, { reason = null } = {}) {
  const request = await RemovalRequest.findOneAndUpdate(
    { _id: requestId, status: 'PENDING' },
    {
      $set: {
        status: 'DISMISSED',
        reviewedBy: actorId,
        reviewedAt: new Date(),
        reviewReason: reason,
      },
    },
    { new: true }
  );

  if (!request) {
    const existing = await RemovalRequest.findById(requestId);
    if (!existing) throw new NotFoundError('RemovalRequest', { id: String(requestId) });
    throw new ConflictError(
      `Cannot dismiss removal with status ${existing.status}.`
    );
  }

  // D5: strikes are NOT cleared.

  await audit({
    actorId,
    action: 'removal.dismissed',
    category: 'REMOVAL',
    targetType: 'RemovalRequest',
    targetId: request._id,
    after: { status: 'DISMISSED' },
    reason,
  });

  return request.toObject();
}

// ============================================================
//  Scheduled-job helpers
// ============================================================

/**
 * Return removal requests whose effective date has passed and which
 * haven't yet been applied. Used by the Phase 17 removal sweep job.
 */
export async function findDueRemovals(asOf = new Date()) {
  return RemovalRequest.find({
    status: 'APPROVED',
    appliedAt: null,
    removalEffectiveAt: { $lte: asOf },
  }).lean();
}

/**
 * Apply a due removal:
 *   1. Mark the request appliedAt.
 *   2. Transition the user to LEFT_ROBLOX_GROUP.
 *   3. Unassign every active role assignment (D8).
 *   4. Record audit.
 *
 * Idempotent: if `appliedAt` is already set, returns { applied: false }.
 * Returns the user and unassigned role keys so the job can DM.
 */
export async function applyRemoval(requestId, { actorId = 'system' } = {}) {
  const request = await RemovalRequest.findOneAndUpdate(
    { _id: requestId, status: 'APPROVED', appliedAt: null },
    { $set: { appliedAt: new Date() } },
    { new: true }
  );
  if (!request) return { applied: false };

  const user = await User.findById(request.user);
  if (!user) return { applied: false, missingUser: true };

  // Update user status.
  user.status = 'LEFT_ROBLOX_GROUP';
  user.lastLeftRobloxAt = new Date();
  await user.save();

  // Unassign every active role.
  const activeAssignments = await RoleAssignment.find({
    user: user._id,
    active: true,
  });
  const unassignedKeys = [];
  for (const a of activeAssignments) {
    a.active = false;
    a.removedAt = new Date();
    a.removedBy = actorId;
    a.reason = 'Removal applied';
    await a.save();
    unassignedKeys.push(a.roleKey);
  }

  // Recompute quotaCategory → NONE since roles are gone.
  user.set('quota.category', 'NONE');
  await user.save();

  await audit({
    actorId,
    action: 'removal.applied',
    category: 'REMOVAL',
    targetType: 'RemovalRequest',
    targetId: request._id,
    after: {
      userStatus: 'LEFT_ROBLOX_GROUP',
      unassignedRoles: unassignedKeys,
    },
  });

  logger.info(
    { requestId: String(request._id), discordId: user.discordId, unassignedRoles: unassignedKeys },
    'Removal applied'
  );

  return {
    applied: true,
    user: user.toObject(),
    unassignedRoles: unassignedKeys,
  };
}

// ============================================================
//  Reads
// ============================================================

export async function listPendingRemovals({ page = 1, pageSize = 25 } = {}) {
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const skip = (page - 1) * pageSize;

  const [items, total] = await Promise.all([
    RemovalRequest.find({ status: 'PENDING' })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    RemovalRequest.countDocuments({ status: 'PENDING' }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getRemovalById(requestId) {
  const r = await RemovalRequest.findById(requestId).lean();
  if (!r) throw new NotFoundError('RemovalRequest', { id: String(requestId) });
  return r;
}

export async function getPendingForUser(discordId) {
  return RemovalRequest.findOne({ discordId, status: 'PENDING' }).lean();
}
import { Leave, User } from '../models/index.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Leave service.
 *
 * Owns every write path for the Leave collection. All state changes
 * are CAS-guarded (findOneAndUpdate with a status precondition) so
 * concurrent operations cannot double-transition.
 *
 * Idempotency:
 *   - Two partial-unique indexes prevent a user from having more than
 *     one PENDING and more than one APPROVED leave.
 *   - We still pre-check before insert to give a friendly error and to
 *     survive the case where the index isn't yet built (fresh install).
 *   - The try/catch around insert is a backstop for concurrent creates.
 */

// ============================================================
//  Create / submit
// ============================================================

/**
 * Submit a leave request. Default status: PENDING.
 * The user must exist and have no PENDING leave at all, and no
 * APPROVED leave overlapping the requested range.
 */
export async function createLeaveRequest(discordId, {
  startAt,
  endAt,
  reason,
  notes = '',
} = {}) {
  if (!startAt || !endAt) {
    throw new ValidationError('startAt and endAt are required.');
  }
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError('startAt and endAt must be valid dates.');
  }
  if (end <= start) {
    throw new ValidationError('endAt must be after startAt.');
  }
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required (min 3 characters).');
  }

  const user = await User.findOne({ discordId });
  if (!user) throw new NotFoundError('User', { discordId });

  // Pre-check 1: user already has a PENDING leave.
  const existingPending = await Leave.findOne({
    user: user._id,
    status: 'PENDING',
  });
  if (existingPending) {
    throw new ConflictError('You already have a pending leave request.');
  }

  // Pre-check 2: user has an APPROVED leave overlapping this range.
  const overlappingApproved = await Leave.findOne({
    user: user._id,
    status: 'APPROVED',
    startAt: { $lt: end },
    endAt: { $gt: start },
  });
  if (overlappingApproved) {
    throw new ConflictError(
      'You already have an approved leave that overlaps this period.'
    );
  }

  try {
    const leave = await Leave.create({
      user: user._id,
      discordId: user.discordId,
      startAt: start,
      endAt: end,
      reason: reason.trim(),
      status: 'PENDING',
      notes: String(notes).slice(0, 1000),
    });

    await audit({
      actorId: discordId,
      action: 'leave.requested',
      category: 'LEAVE',
      targetType: 'Leave',
      targetId: leave._id,
      after: { startAt: start, endAt: end, reason: reason.trim() },
    });

    logger.info({ discordId, leaveId: String(leave._id) }, 'Leave requested');
    return leave.toObject();
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError('You already have a pending leave request.');
    }
    throw err;
  }
}

// ============================================================
//  Review
// ============================================================

/**
 * Approve a PENDING leave.
 * CAS: PENDING → APPROVED.
 * Idempotent: re-approving an APPROVED leave returns
 * { approved: false, alreadyApproved: true }.
 */
export async function approveLeave(actorId, leaveId, { reason = null } = {}) {
  const leave = await Leave.findOneAndUpdate(
    { _id: leaveId, status: 'PENDING' },
    {
      $set: {
        status: 'APPROVED',
        reviewedBy: actorId,
        reviewedAt: new Date(),
        reviewReason: reason,
      },
    },
    { new: true }
  );

  if (!leave) {
    const existing = await Leave.findById(leaveId);
    if (!existing) throw new NotFoundError('Leave', { id: String(leaveId) });
    if (existing.status === 'APPROVED') {
      return { approved: false, alreadyApproved: true, leave: existing.toObject() };
    }
    throw new ConflictError(
      `Cannot approve leave with status ${existing.status}.`
    );
  }

  await audit({
    actorId,
    action: 'leave.approved',
    category: 'LEAVE',
    targetType: 'Leave',
    targetId: leave._id,
    after: { status: 'APPROVED' },
    reason,
  });

  logger.info({ leaveId: String(leave._id), actorId }, 'Leave approved');
  return { approved: true, alreadyApproved: false, leave: leave.toObject() };
}

export async function rejectLeave(actorId, leaveId, { reason } = {}) {
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required to reject a leave.');
  }

  const leave = await Leave.findOneAndUpdate(
    { _id: leaveId, status: 'PENDING' },
    {
      $set: {
        status: 'REJECTED',
        reviewedBy: actorId,
        reviewedAt: new Date(),
        reviewReason: reason.trim(),
      },
    },
    { new: true }
  );

  if (!leave) {
    const existing = await Leave.findById(leaveId);
    if (!existing) throw new NotFoundError('Leave', { id: String(leaveId) });
    throw new ConflictError(
      `Cannot reject leave with status ${existing.status}.`
    );
  }

  await audit({
    actorId,
    action: 'leave.rejected',
    category: 'LEAVE',
    targetType: 'Leave',
    targetId: leave._id,
    after: { status: 'REJECTED' },
    reason: reason.trim(),
  });

  return leave.toObject();
}

// ============================================================
//  End / cancel
// ============================================================

/**
 * End an APPROVED leave early.
 * Sets status to EXPIRED with expiredAt = now.
 * Idempotent: ending a non-APPROVED leave is a no-op.
 */
export async function endLeave(actorId, leaveId, { reason = null } = {}) {
  const leave = await Leave.findOneAndUpdate(
    { _id: leaveId, status: 'APPROVED' },
    {
      $set: {
        status: 'EXPIRED',
        expiredAt: new Date(),
        reviewReason: reason ?? 'Ended early',
      },
    },
    { new: true }
  );

  if (!leave) {
    const existing = await Leave.findById(leaveId);
    if (!existing) throw new NotFoundError('Leave', { id: String(leaveId) });
    return { ended: false, leave: existing.toObject() };
  }

  await audit({
    actorId,
    action: 'leave.ended',
    category: 'LEAVE',
    targetType: 'Leave',
    targetId: leave._id,
    after: { status: 'EXPIRED' },
    reason,
  });

  return { ended: true, leave: leave.toObject() };
}

/**
 * Cancel a PENDING leave (user withdraws before approval).
 */
export async function cancelLeave(actorId, leaveId, { reason = null } = {}) {
  const leave = await Leave.findOneAndUpdate(
    { _id: leaveId, status: 'PENDING' },
    {
      $set: {
        status: 'CANCELLED',
        reviewReason: reason ?? 'Cancelled by requester',
      },
    },
    { new: true }
  );

  if (!leave) {
    const existing = await Leave.findById(leaveId);
    if (!existing) throw new NotFoundError('Leave', { id: String(leaveId) });
    return { cancelled: false, leave: existing.toObject() };
  }

  await audit({
    actorId,
    action: 'leave.cancelled',
    category: 'LEAVE',
    targetType: 'Leave',
    targetId: leave._id,
    after: { status: 'CANCELLED' },
    reason,
  });

  return { cancelled: true, leave: leave.toObject() };
}

// ============================================================
//  Expiry (job helper)
// ============================================================

/**
 * Mark all APPROVED leaves whose endAt has passed as EXPIRED.
 * Returns the number expired.
 * Idempotent: rows already EXPIRED are skipped by the status filter.
 */
export async function expireLeaves({ asOf = new Date() } = {}) {
  const result = await Leave.updateMany(
    { status: 'APPROVED', endAt: { $lte: asOf } },
    { $set: { status: 'EXPIRED', expiredAt: asOf } }
  );
  const count = result.modifiedCount ?? 0;
  if (count > 0) {
    logger.info({ count }, 'Leaves expired');
  }
  return count;
}

// ============================================================
//  Reads
// ============================================================

export async function getLeaveById(leaveId) {
  const leave = await Leave.findById(leaveId).lean();
  if (!leave) throw new NotFoundError('Leave', { id: String(leaveId) });
  return leave;
}

export async function listLeaves({
  status,
  discordId,
  page = 1,
  pageSize = 25,
} = {}) {
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const skip = (page - 1) * pageSize;

  const filter = {};
  if (status && status !== 'ANY') filter.status = status;
  if (discordId) filter.discordId = discordId;

  const [items, total] = await Promise.all([
    Leave.find(filter).sort({ startAt: -1 }).skip(skip).limit(pageSize).lean(),
    Leave.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Return the user's currently active APPROVED leave, if any.
 * "Active" = today is within [startAt, endAt].
 */
export async function getActiveLeaveForUser(discordId) {
  const now = new Date();
  return Leave.findOne({
    discordId,
    status: 'APPROVED',
    startAt: { $lte: now },
    endAt: { $gte: now },
  }).lean();
}

/**
 * Does the user have an APPROVED leave overlapping the given period?
 * Used by quota evaluation as a defense-in-depth check (Phase 9 also
 * queries directly).
 */
export async function hasApprovedLeaveOverlapping(userObjectId, period) {
  const leave = await Leave.findOne({
    user: userObjectId,
    status: 'APPROVED',
    startAt: { $lt: period.endAt },
    endAt: { $gt: period.startAt },
  }).lean();
  return Boolean(leave);
}
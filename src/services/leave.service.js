import * as leaveRepo from '../db/repositories/leave.repository.js';
import * as userRepo from '../db/repositories/user.repository.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';
import { db } from '../db/client.js';
import logger from '../config/logger.js';
import { dmLeaveUser } from '../bot/utils/leaveDm.js';
import { COLORS } from '../bot/embedBuilders.js';

// ============================================================
//  Create / submit
// ============================================================

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

  const user = await userRepo.findByDiscordId(discordId);
  if (!user) throw new NotFoundError('User', { discordId });

  const leave = await db.transaction(async (trx) => {
    const existingPending = await leaveRepo.findPendingForUser(user.id, trx);
    if (existingPending) {
      throw new ConflictError('You already have a pending leave request.');
    }

    const overlappingApproved = await leaveRepo.findOverlappingApproved(
      user.id, start, end, trx
    );
    if (overlappingApproved) {
      throw new ConflictError(
        'You already have an approved leave that overlaps this period.'
      );
    }

    return leaveRepo.create({
      userId: user.id,
      discordId: user.discord_id,
      startAt: start,
      endAt: end,
      reason: reason.trim(),
      status: 'PENDING',
      notes: String(notes).slice(0, 1000),
    }, trx);
  });

  await audit({
    actorId: discordId,
    action: 'leave.requested',
    category: 'LEAVE',
    targetType: 'Leave',
    targetId: leave.id,
    after: { startAt: start, endAt: end, reason: reason.trim() },
  });

  logger.info({ discordId, leaveId: leave.id }, 'Leave requested');
  return leave;
}

// ============================================================
//  Review
// ============================================================

export async function approveLeave(actorId, leaveId, { reason = null, client = null } = {}) {
  const leave = await leaveRepo.approveAtomic(leaveId, {
    reviewedBy: actorId,
    reason,
  });

  if (!leave) {
    const existing = await leaveRepo.findById(leaveId);
    if (!existing) throw new NotFoundError('Leave', { id: String(leaveId) });
    if (existing.status === 'APPROVED') {
      return { approved: false, alreadyApproved: true, leave: existing };
    }
    throw new ConflictError(
      'Cannot approve leave with status ' + existing.status + '.'
    );
  }

  await audit({
    actorId,
    action: 'leave.approved',
    category: 'LEAVE',
    targetType: 'Leave',
    targetId: leave.id,
    after: { status: 'APPROVED' },
    reason,
  });

  await notifyLeaveUser(client, leave, {
    title: 'Leave Approved',
    color: COLORS.SUCCESS,
    actorId,
    actorLabel: 'Approved By',
    reason,
    extraLine: 'Your leave has been approved. You are exempt from weekly quota for this period.',
  });

  logger.info({ leaveId: leave.id, actorId }, 'Leave approved');
  return { approved: true, alreadyApproved: false, leave };
}

export async function rejectLeave(actorId, leaveId, { reason, client = null } = {}) {
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required to reject a leave.');
  }

  const leave = await leaveRepo.rejectAtomic(leaveId, {
    reviewedBy: actorId,
    reason: reason.trim(),
  });

  if (!leave) {
    const existing = await leaveRepo.findById(leaveId);
    if (!existing) throw new NotFoundError('Leave', { id: String(leaveId) });
    throw new ConflictError(
      'Cannot reject leave with status ' + existing.status + '.'
    );
  }

  await audit({
    actorId,
    action: 'leave.rejected',
    category: 'LEAVE',
    targetType: 'Leave',
    targetId: leave.id,
    after: { status: 'REJECTED' },
    reason: reason.trim(),
  });

  await notifyLeaveUser(client, leave, {
    title: 'Leave Rejected',
    color: COLORS.ERROR,
    actorId,
    actorLabel: 'Reviewed By',
    reason: reason.trim(),
    extraLine: 'Your leave request was rejected. Contact High Command if you believe this is an error.',
  });

  return leave;
}

// ============================================================
//  End / cancel
// ============================================================

export async function endLeave(actorId, leaveId, { reason = null, client = null } = {}) {
  const leave = await leaveRepo.endAtomic(leaveId, { reason });

  if (!leave) {
    const existing = await leaveRepo.findById(leaveId);
    if (!existing) throw new NotFoundError('Leave', { id: String(leaveId) });
    return { ended: false, leave: existing };
  }

  await audit({
    actorId,
    action: 'leave.ended',
    category: 'LEAVE',
    targetType: 'Leave',
    targetId: leave.id,
    after: { status: 'EXPIRED' },
    reason,
  });

  await notifyLeaveUser(client, leave, {
    title: 'Leave Ended',
    color: COLORS.WARNING,
    actorId,
    actorLabel: 'Ended By',
    reason,
    extraLine: 'Your leave was ended early. You are once again subject to weekly quota.',
  });

  return { ended: true, leave };
}

export async function cancelLeave(actorId, leaveId, { reason = null, client = null } = {}) {
  const leave = await leaveRepo.cancelAtomic(leaveId, { reason });

  if (!leave) {
    const existing = await leaveRepo.findById(leaveId);
    if (!existing) throw new NotFoundError('Leave', { id: String(leaveId) });
    return { cancelled: false, leave: existing };
  }

  await audit({
    actorId,
    action: 'leave.cancelled',
    category: 'LEAVE',
    targetType: 'Leave',
    targetId: leave.id,
    after: { status: 'CANCELLED' },
    reason,
  });

  return { cancelled: true, leave };
}

// ============================================================
//  Expiry
// ============================================================

export async function expireLeaves({ asOf = new Date() } = {}) {
  const affected = await leaveRepo.expireDue(asOf);
  if (affected > 0) logger.info({ count: affected }, 'Leaves expired');
  return affected;
}

export async function findDueForExpiry({ asOf = new Date() } = {}) {
  return leaveRepo.findDueForExpiry(asOf);
}

// ============================================================
//  Reads
// ============================================================

export async function getLeaveById(leaveId) {
  const leave = await leaveRepo.findById(leaveId);
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

  const { items, total } = await leaveRepo.list({ status, discordId, page, pageSize });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getActiveLeaveForUser(discordId) {
  return leaveRepo.findActiveForDiscordId(discordId);
}

export async function hasApprovedLeaveOverlapping(userObjectId, period) {
  const userIds = await leaveRepo.findOverlappingApprovedInPeriod({
    start_at: period.startAt,
    end_at: period.endAt,
  });
  return userIds.includes(userObjectId);
}

// ============================================================
//  Internal — DM helper
// ============================================================

async function notifyLeaveUser(client, leave, {
  title,
  color,
  actorId = null,
  actorLabel = 'Reviewed By',
  reason = null,
  extraLine = null,
} = {}) {
  if (!client) return;
  try {
    // leaveDm expects camelCase fields — the repo returns snake_case.
    await dmLeaveUser(client, {
      discordId: leave.discord_id,
      startAt: leave.start_at,
      endAt: leave.end_at,
      reason: leave.reason,
    }, {
      title,
      color,
      actorId,
      actorLabel,
      reason,
      extraLine,
    });
  } catch (err) {
    logger.warn(
      { err: err.message, leaveId: leave.id },
      'Leave DM failed (non-fatal)'
    );
  }
}
export async function createVoluntaryLeave(discordId, { reason, effectiveAt = null } = {}) {
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required (min 3 characters).');
  }

  const user = await userRepo.findByDiscordId(discordId);
  if (!user) throw new NotFoundError('User', { discordId });

  // Delegate to removalRequest service — it knows the removal flow
  const { createVoluntary } = await import('./removalRequest.service.js');
  return createVoluntary(discordId, { reason: reason.trim(), effectiveAt });
}
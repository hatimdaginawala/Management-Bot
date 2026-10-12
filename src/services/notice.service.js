import * as noticeRepo from '../db/repositories/notice.repository.js';
import * as userRepo from '../db/repositories/user.repository.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Notice service. Public API unchanged.
 */

const VALID_TYPES = ['INACTIVITY', 'WARNING', 'ADMINISTRATIVE', 'OTHER'];

// ============================================================
//  Create
// ============================================================

export async function createNotice(actorId, {
  targetDiscordId,
  type,
  reason,
  startAt = null,
  endAt = null,
  grantsQuotaExemption = null,
  notes = '',
} = {}) {
  if (!targetDiscordId) throw new ValidationError('targetDiscordId is required.');
  if (!type || !VALID_TYPES.includes(type)) {
    throw new ValidationError('type must be one of: ' + VALID_TYPES.join(', '));
  }
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required (min 3 characters).');
  }

  const user = await userRepo.findByDiscordId(targetDiscordId);
  if (!user) throw new NotFoundError('User', { discordId: targetDiscordId });

  const start = startAt ? new Date(startAt) : new Date();
  const end = endAt ? new Date(endAt) : null;
  if (Number.isNaN(start.getTime())) {
    throw new ValidationError('startAt must be a valid date.');
  }
  if (end && Number.isNaN(end.getTime())) {
    throw new ValidationError('endAt must be a valid date or null.');
  }
  if (end && end <= start) {
    throw new ValidationError('endAt must be after startAt.');
  }

  const grants = grantsQuotaExemption === null
    ? type === 'INACTIVITY'
    : Boolean(grantsQuotaExemption);

  const notice = await noticeRepo.create({
    userId: user.id,
    discordId: user.discord_id,
    type,
    reason: reason.trim(),
    startAt: start,
    endAt: end,
    status: 'ACTIVE',
    grantsQuotaExemption: grants,
    createdBy: actorId,
    notes: String(notes).slice(0, 1000),
  });

  await audit({
    actorId,
    action: 'notice.created',
    category: 'NOTICE',
    targetType: 'Notice',
    targetId: notice.id,
    after: {
      discordId: targetDiscordId,
      type,
      grantsQuotaExemption: grants,
      endAt: end,
    },
    reason: reason.trim(),
  });

  logger.info(
    { noticeId: notice.id, discordId: targetDiscordId, type },
    'Notice created'
  );
  return notice;
}

// ============================================================
//  Cancel
// ============================================================

export async function cancelNotice(actorId, noticeId, { reason = null } = {}) {
  const notice = await noticeRepo.cancelAtomic(noticeId, {
    cancelledBy: actorId,
    reason,
  });

  if (!notice) {
    const existing = await noticeRepo.findById(noticeId);
    if (!existing) throw new NotFoundError('Notice', { id: String(noticeId) });
    return { cancelled: false, notice: existing };
  }

  await audit({
    actorId,
    action: 'notice.cancelled',
    category: 'NOTICE',
    targetType: 'Notice',
    targetId: notice.id,
    after: { status: 'CANCELLED' },
    reason,
  });

  return { cancelled: true, notice };
}

// ============================================================
//  Expiry
// ============================================================

export async function expireNotices({ asOf = new Date() } = {}) {
  const affected = await noticeRepo.expireDue(asOf);
  if (affected > 0) logger.info({ count: affected }, 'Notices expired');
  return affected;
}

// ============================================================
//  Reads
// ============================================================

export async function getNoticeById(noticeId) {
  const notice = await noticeRepo.findById(noticeId);
  if (!notice) throw new NotFoundError('Notice', { id: String(noticeId) });
  return notice;
}

export async function listNotices({
  status,
  discordId,
  type,
  page = 1,
  pageSize = 25,
} = {}) {
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));

  const { items, total } = await noticeRepo.list({ status, discordId, type, page, pageSize });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getActiveNoticesForUser(discordId) {
  return noticeRepo.listActiveForDiscordId(discordId);
}

export async function hasActiveExemptNotice(userObjectId, asOf = new Date()) {
  return noticeRepo.hasActiveExempt(userObjectId, asOf);
}

// ============================================================
//  Extension flow
// ============================================================

export async function requestExtension(discordId, noticeId, {
  newEndAt,
  reason,
}) {
  const notice = await noticeRepo.findById(noticeId);
  if (!notice) throw new NotFoundError('Notice', { id: String(noticeId) });
  if (notice.discord_id !== discordId) {
    throw new ValidationError('You can only extend your own notices.');
  }
  if (notice.status !== 'ACTIVE') {
    throw new ValidationError('That notice is no longer active.');
  }
  if (notice.pending_extension_status === 'PENDING') {
    throw new ValidationError('You already have a pending extension request for this notice.');
  }

  const newEnd = new Date(newEndAt);
  if (Number.isNaN(newEnd.getTime())) {
    throw new ValidationError('New end date must be valid.');
  }
  if (newEnd <= new Date()) {
    throw new ValidationError('New end date must be in the future.');
  }
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required.');
  }

  const updated = await noticeRepo.setPendingExtension(notice.id, {
    requestedBy: discordId,
    newEndAt: newEnd,
    reason: reason.trim(),
  });

  await audit({
    actorId: discordId,
    action: 'notice.extension_requested',
    category: 'NOTICE',
    targetType: 'Notice',
    targetId: notice.id,
    after: { newEndAt: newEnd, reason: reason.trim() },
  });

  return updated;
}

export async function listPendingExtensions({ limit = 25 } = {}) {
  return noticeRepo.findPendingExtensions({ limit });
}

export async function approveExtension(actorId, noticeId, { reviewReason = null } = {}) {
  const notice = await noticeRepo.approveExtensionAtomic(noticeId, {
    reviewedBy: actorId,
    reviewReason,
  });
  if (!notice) {
    const existing = await noticeRepo.findById(noticeId);
    if (!existing) throw new NotFoundError('Notice', { id: String(noticeId) });
    throw new ValidationError('Notice has no pending extension.');
  }

  await audit({
    actorId,
    action: 'notice.extension_approved',
    category: 'NOTICE',
    targetType: 'Notice',
    targetId: notice.id,
    after: { newEndAt: notice.end_at },
  });

  return notice;
}

export async function rejectExtension(actorId, noticeId, { reviewReason } = {}) {
  if (!reviewReason || reviewReason.trim().length < 3) {
    throw new ValidationError('A review reason is required.');
  }
  const notice = await noticeRepo.rejectExtensionAtomic(noticeId, {
    reviewedBy: actorId,
    reviewReason: reviewReason.trim(),
  });
  if (!notice) {
    const existing = await noticeRepo.findById(noticeId);
    if (!existing) throw new NotFoundError('Notice', { id: String(noticeId) });
    throw new ValidationError('Notice has no pending extension.');
  }

  await audit({
    actorId,
    action: 'notice.extension_rejected',
    category: 'NOTICE',
    targetType: 'Notice',
    targetId: notice.id,
    reason: reviewReason.trim(),
  });

  return notice;
}
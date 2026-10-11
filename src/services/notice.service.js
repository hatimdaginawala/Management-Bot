import { Notice, User } from '../models/index.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Notice service.
 *
 * Notices are informational records attached to a user. Types:
 *   INACTIVITY      - user flagged inactive; optionally grants quota exemption
 *   WARNING         - administrative warning
 *   ADMINISTRATIVE  - general admin notice
 *   OTHER           - catch-all
 *
 * Lifecycle:
 *   ACTIVE  → EXPIRED (when endAt passes, via Phase 17 job)
 *           → CANCELLED (manual, by an authorized user)
 *
 * Notices are NOT unique per user — a user can have multiple active
 * notices simultaneously. For example, an INACTIVITY notice and a
 * separate WARNING can coexist.
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
    throw new ValidationError(`type must be one of: ${VALID_TYPES.join(', ')}`);
  }
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required (min 3 characters).');
  }

  const user = await User.findOne({ discordId: targetDiscordId });
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

  // Default exemption behavior: INACTIVITY grants exemption by default,
  // all others do not. Caller may override.
  const grants =
    grantsQuotaExemption === null
      ? type === 'INACTIVITY'
      : Boolean(grantsQuotaExemption);

  const notice = await Notice.create({
    user: user._id,
    discordId: user.discordId,
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
    targetId: notice._id,
    after: {
      discordId: targetDiscordId,
      type,
      grantsQuotaExemption: grants,
      endAt: end,
    },
    reason: reason.trim(),
  });

  logger.info(
    { noticeId: String(notice._id), discordId: targetDiscordId, type },
    'Notice created'
  );
  return notice.toObject();
}

// ============================================================
//  Cancel
// ============================================================

export async function cancelNotice(actorId, noticeId, { reason = null } = {}) {
  const notice = await Notice.findOneAndUpdate(
    { _id: noticeId, status: 'ACTIVE' },
    {
      $set: {
        status: 'CANCELLED',
        cancelledBy: actorId,
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    },
    { new: true }
  );

  if (!notice) {
    const existing = await Notice.findById(noticeId);
    if (!existing) throw new NotFoundError('Notice', { id: String(noticeId) });
    return { cancelled: false, notice: existing.toObject() };
  }

  await audit({
    actorId,
    action: 'notice.cancelled',
    category: 'NOTICE',
    targetType: 'Notice',
    targetId: notice._id,
    after: { status: 'CANCELLED' },
    reason,
  });

  return { cancelled: true, notice: notice.toObject() };
}

// ============================================================
//  Expiry (job helper)
// ============================================================

/**
 * Mark all ACTIVE notices whose endAt has passed as EXPIRED.
 * Notices with `endAt: null` are open-ended and remain ACTIVE.
 * Idempotent.
 */
export async function expireNotices({ asOf = new Date() } = {}) {
  const result = await Notice.updateMany(
    {
      status: 'ACTIVE',
      endAt: { $ne: null, $lte: asOf },
    },
    { $set: { status: 'EXPIRED', expiredAt: asOf } }
  );
  const count = result.modifiedCount ?? 0;
  if (count > 0) {
    logger.info({ count }, 'Notices expired');
  }
  return count;
}

// ============================================================
//  Reads
// ============================================================

export async function getNoticeById(noticeId) {
  const notice = await Notice.findById(noticeId).lean();
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
  const skip = (page - 1) * pageSize;

  const filter = {};
  if (status && status !== 'ANY') filter.status = status;
  if (discordId) filter.discordId = discordId;
  if (type) filter.type = type;

  const [items, total] = await Promise.all([
    Notice.find(filter).sort({ startAt: -1 }).skip(skip).limit(pageSize).lean(),
    Notice.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getActiveNoticesForUser(discordId) {
  return Notice.find({ discordId, status: 'ACTIVE' })
    .sort({ startAt: -1 })
    .lean();
}

/**
 * Does the user have an ACTIVE quota-exempting notice right now?
 * Used as a defense-in-depth exemption check.
 */
export async function hasActiveExemptNotice(userObjectId, asOf = new Date()) {
  const notice = await Notice.findOne({
    user: userObjectId,
    status: 'ACTIVE',
    grantsQuotaExemption: true,
    startAt: { $lte: asOf },
    $or: [{ endAt: null }, { endAt: { $gte: asOf } }],
  }).lean();
  return Boolean(notice);
}
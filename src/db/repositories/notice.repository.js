import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const BOOLEAN_FIELDS = ['grants_quota_exemption'];
const CTX = { repository: 'notice' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('notices').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findById' });
}

export async function create(data, trx = db) {
  return withDbErrors(async () => {
    const [id] = await trx('notices').insert({
      user_id: data.userId,
      discord_id: data.discordId,
      type: data.type,
      reason: data.reason,
      start_at: data.startAt ?? new Date(),
      end_at: data.endAt ?? null,
      status: data.status ?? 'ACTIVE',
      grants_quota_exemption: data.grantsQuotaExemption ?? false,
      created_by: data.createdBy,
      notes: data.notes ?? null,
    });
    const row = await trx('notices').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'create' });
}

export async function cancelAtomic(id, { cancelledBy, reason }) {
  return withDbErrors(async () => {
    const affected = await db('notices')
      .where({ id, status: 'ACTIVE' })
      .update({
        status: 'CANCELLED',
        cancelled_by: cancelledBy,
        cancelled_at: new Date(),
        cancellation_reason: reason,
      });
    if (affected === 0) return null;
    const row = await db('notices').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'cancelAtomic' });
}

/**
 * Expire all ACTIVE notices past end_at.
 * Open-ended notices (end_at = NULL) are skipped.
 */
export async function expireDue(asOf = new Date()) {
  return withDbErrors(async () => {
    return db('notices')
      .where({ status: 'ACTIVE' })
      .whereNotNull('end_at')
      .where('end_at', '<=', asOf)
      .update({ status: 'EXPIRED', expired_at: asOf });
  }, { ...CTX, method: 'expireDue' });
}

export async function listActiveForDiscordId(discordId) {
  return withDbErrors(async () => {
    const rows = await db('notices')
      .where({ discord_id: discordId, status: 'ACTIVE' })
      .orderBy('start_at', 'desc');
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'listActiveForDiscordId' });
}

/**
 * Has the user an ACTIVE notice that grants quota exemption?
 */
export async function hasActiveExempt(userId, asOf = new Date(), trx = db) {
  return withDbErrors(async () => {
    const row = await trx('notices')
      .where({ user_id: userId, status: 'ACTIVE', grants_quota_exemption: true })
      .where('start_at', '<=', asOf)
      .andWhere((builder) => {
        builder.whereNull('end_at').orWhere('end_at', '>=', asOf);
      })
      .first();
    return Boolean(row);
  }, { ...CTX, method: 'hasActiveExempt' });
}

/**
 * Active quota-exempting notices overlapping a period.
 * Used by quota evaluation.
 */
export async function findActiveExemptOverlappingPeriod(period) {
  return withDbErrors(async () => {
    const rows = await db('notices')
      .where({ status: 'ACTIVE', grants_quota_exemption: true })
      .where('start_at', '<', period.end_at)
      .andWhere((builder) => {
        builder.whereNull('end_at').orWhere('end_at', '>', period.start_at);
      })
      .select('user_id');
    return rows.map((r) => Number(r.user_id));
  }, { ...CTX, method: 'findActiveExemptOverlappingPeriod' });
}

export async function list({ status, discordId, type, page = 1, pageSize = 25 } = {}) {
  return withDbErrors(async () => {
    const q = db('notices');
    if (status && status !== 'ANY') q.where('status', status);
    if (discordId) q.where('discord_id', discordId);
    if (type) q.where('type', type);

    const [countRow] = await q.clone().count({ count: '*' });
    const total = Number(countRow.count);

    const offset = (Math.max(1, page) - 1) * pageSize;
    const rows = await q.clone().orderBy('start_at', 'desc').limit(pageSize).offset(offset);

    return { items: convertRows(rows, { booleanFields: BOOLEAN_FIELDS }), total };
  }, { ...CTX, method: 'list' });
}

/**
 * List ACTIVE notices with pending extension requests.
 */
export async function findPendingExtensions({ limit = 25 } = {}) {
  return withDbErrors(async () => {
    const rows = await db('notices')
      .where({ pending_extension_status: 'PENDING' })
      .orderBy('pending_extension_requested_at', 'asc')
      .limit(limit);
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findPendingExtensions' });
}

/**
 * Mark a pending extension as PENDING (user requested).
 */
export async function setPendingExtension(id, {
  requestedBy,
  newEndAt,
  reason,
}) {
  return withDbErrors(async () => {
    await db('notices').where({ id }).update({
      pending_extension_status: 'PENDING',
      pending_extension_requested_by: requestedBy,
      pending_extension_requested_at: new Date(),
      pending_extension_new_end_at: newEndAt,
      pending_extension_reason: reason,
      pending_extension_reviewed_by: null,
      pending_extension_reviewed_at: null,
      pending_extension_review_reason: null,
    });
    const row = await db('notices').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'setPendingExtension' });
}

/**
 * Approve a pending extension: sets end_at to the requested value and
 * marks the extension APPROVED.
 */
export async function approveExtensionAtomic(id, { reviewedBy, reviewReason = null }) {
  return withDbErrors(async () => {
    const notice = await db('notices').where({ id }).first();
    if (!notice || notice.pending_extension_status !== 'PENDING') return null;
    await db('notices').where({ id }).update({
      end_at: notice.pending_extension_new_end_at,
      pending_extension_status: 'APPROVED',
      pending_extension_reviewed_by: reviewedBy,
      pending_extension_reviewed_at: new Date(),
      pending_extension_review_reason: reviewReason,
    });
    const updated = await db('notices').where({ id }).first();
    return convertRow(updated, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'approveExtensionAtomic' });
}

/**
 * Reject a pending extension.
 */
export async function rejectExtensionAtomic(id, { reviewedBy, reviewReason }) {
  return withDbErrors(async () => {
    const affected = await db('notices')
      .where({ id, pending_extension_status: 'PENDING' })
      .update({
        pending_extension_status: 'REJECTED',
        pending_extension_reviewed_by: reviewedBy,
        pending_extension_reviewed_at: new Date(),
        pending_extension_review_reason: reviewReason,
      });
    if (affected === 0) return null;
    const row = await db('notices').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'rejectExtensionAtomic' });
}
export async function countActiveInRange({ from, to }) {
  return withDbErrors(async () => {
    const q = db('notices')
      .where('status', 'ACTIVE')
      .where('start_at', '<', to)
      .andWhere((builder) => {
        builder.whereNull('end_at').orWhere('end_at', '>', from);
      });
    const [row] = await q.count({ count: '*' });
    return Number(row.count);
  }, { repository: 'notice', method: 'countActiveInRange' });
}
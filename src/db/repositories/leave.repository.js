import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const CTX = { repository: 'leave' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('leaves').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'findById' });
}

export async function findPendingForUser(userId, trx = db) {
  return withDbErrors(async () => {
    const row = await trx('leaves')
      .where({ user_id: userId, status: 'PENDING' })
      .first();
    return convertRow(row);
  }, { ...CTX, method: 'findPendingForUser' });
}

export async function findActiveForDiscordId(discordId) {
  return withDbErrors(async () => {
    const now = new Date();
    const row = await db('leaves')
      .where({ discord_id: discordId, status: 'APPROVED' })
      .where('start_at', '<=', now)
      .where('end_at', '>=', now)
      .first();
    return convertRow(row);
  }, { ...CTX, method: 'findActiveForDiscordId' });
}

/**
 * Overlap check — does the user have an APPROVED leave in this range?
 * Used by createLeaveRequest.
 */
export async function findOverlappingApproved(userId, startAt, endAt, trx = db) {
  return withDbErrors(async () => {
    const row = await trx('leaves')
      .where({ user_id: userId, status: 'APPROVED' })
      .where('start_at', '<', endAt)
      .where('end_at', '>', startAt)
      .first();
    return convertRow(row);
  }, { ...CTX, method: 'findOverlappingApproved' });
}

export async function create(data, trx = db) {
  return withDbErrors(async () => {
    const [id] = await trx('leaves').insert({
      user_id: data.userId,
      discord_id: data.discordId,
      start_at: data.startAt,
      end_at: data.endAt,
      reason: data.reason,
      status: data.status ?? 'PENDING',
      notes: data.notes ?? null,
    });
    const row = await trx('leaves').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'create' });
}

export async function approveAtomic(id, { reviewedBy, reason }) {
  return withDbErrors(async () => {
    const affected = await db('leaves')
      .where({ id, status: 'PENDING' })
      .update({
        status: 'APPROVED',
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
        review_reason: reason ?? null,
      });
    if (affected === 0) return null;
    const row = await db('leaves').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'approveAtomic' });
}

export async function rejectAtomic(id, { reviewedBy, reason }) {
  return withDbErrors(async () => {
    const affected = await db('leaves')
      .where({ id, status: 'PENDING' })
      .update({
        status: 'REJECTED',
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
        review_reason: reason,
      });
    if (affected === 0) return null;
    const row = await db('leaves').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'rejectAtomic' });
}

export async function endAtomic(id, { reason }) {
  return withDbErrors(async () => {
    const affected = await db('leaves')
      .where({ id, status: 'APPROVED' })
      .update({
        status: 'EXPIRED',
        expired_at: new Date(),
        review_reason: reason ?? 'Ended early',
      });
    if (affected === 0) return null;
    const row = await db('leaves').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'endAtomic' });
}

export async function cancelAtomic(id, { reason }) {
  return withDbErrors(async () => {
    const affected = await db('leaves')
      .where({ id, status: 'PENDING' })
      .update({
        status: 'CANCELLED',
        review_reason: reason ?? 'Cancelled by requester',
      });
    if (affected === 0) return null;
    const row = await db('leaves').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'cancelAtomic' });
}

/**
 * Mark all APPROVED leaves whose end_at has passed as EXPIRED.
 * Returns the number affected.
 */
export async function expireDue(asOf = new Date()) {
  return withDbErrors(async () => {
    return db('leaves')
      .where({ status: 'APPROVED' })
      .where('end_at', '<=', asOf)
      .update({
        status: 'EXPIRED',
        expired_at: asOf,
      });
  }, { ...CTX, method: 'expireDue' });
}

/**
 * Return all APPROVED leaves that will expire soon.
 * Used by the expiration job to send DMs.
 */
export async function findDueForExpiry(asOf = new Date()) {
  return withDbErrors(async () => {
    const rows = await db('leaves')
      .where({ status: 'APPROVED' })
      .where('end_at', '<=', asOf);
    return convertRows(rows);
  }, { ...CTX, method: 'findDueForExpiry' });
}

export async function list({ status, discordId, page = 1, pageSize = 25 } = {}) {
  return withDbErrors(async () => {
    const q = db('leaves');
    if (status && status !== 'ANY') q.where('status', status);
    if (discordId) q.where('discord_id', discordId);

    const [countRow] = await q.clone().count({ count: '*' });
    const total = Number(countRow.count);

    const offset = (Math.max(1, page) - 1) * pageSize;
    const rows = await q.clone().orderBy('start_at', 'desc').limit(pageSize).offset(offset);

    return { items: convertRows(rows), total };
  }, { ...CTX, method: 'list' });
}

/**
 * Find APPROVED leaves overlapping a period, for quota evaluation.
 */
export async function findOverlappingApprovedInPeriod(period) {
  return withDbErrors(async () => {
    const rows = await db('leaves')
      .where({ status: 'APPROVED' })
      .where('start_at', '<', period.end_at)
      .where('end_at', '>', period.start_at)
      .select('user_id');
    return rows.map((r) => Number(r.user_id));
  }, { ...CTX, method: 'findOverlappingApprovedInPeriod' });
}
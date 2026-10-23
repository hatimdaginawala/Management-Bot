import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const CTX = { repository: 'removalRequest' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('removal_requests').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'findById' });
}

export async function findPendingForUser(userId, trx = db) {
  return withDbErrors(async () => {
    const row = await trx('removal_requests')
      .where({ user_id: userId, status: 'PENDING' })
      .first();
    return convertRow(row);
  }, { ...CTX, method: 'findPendingForUser' });
}

export async function ensurePending(data, trx = db) {
  return withDbErrors(async () => {
    const existing = await trx('removal_requests')
      .where({ user_id: data.userId, status: 'PENDING' })
      .first();
    if (existing) return { created: false, row: convertRow(existing) };

    const [id] = await trx('removal_requests').insert({
      user_id: data.userId,
      discord_id: data.discordId,
      reason: data.reason ?? 'THRESHOLD',
      strike_count: data.strikeCount ?? 0,
      strike_threshold: data.strikeThreshold ?? 0,
      description: data.description ?? null,
      status: 'PENDING',
    });
    const row = await trx('removal_requests').where({ id }).first();
    return { created: true, row: convertRow(row) };
  }, { ...CTX, method: 'ensurePending' });
}

export async function createManual(data, trx = db) {
  return withDbErrors(async () => {
    const [id] = await trx('removal_requests').insert({
      user_id: data.userId,
      discord_id: data.discordId,
      reason: data.reason ?? 'MANUAL',
      strike_count: data.strikeCount ?? 0,
      strike_threshold: data.strikeThreshold ?? 0,
      description: data.description,
      status: 'PENDING',
    });
    const row = await trx('removal_requests').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'createManual' });
}

export async function approveAtomic(id, {
  reviewedBy,
  reason,
  removalEffectiveAt,
}) {
  return withDbErrors(async () => {
    const affected = await db('removal_requests')
      .where({ id, status: 'PENDING' })
      .update({
        status: 'APPROVED',
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
        review_reason: reason ?? null,
        removal_effective_at: removalEffectiveAt,
      });
    if (affected === 0) return null;
    const row = await db('removal_requests').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'approveAtomic' });
}

export async function dismissAtomic(id, { reviewedBy, reason }) {
  return withDbErrors(async () => {
    const affected = await db('removal_requests')
      .where({ id, status: 'PENDING' })
      .update({
        status: 'DISMISSED',
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
        review_reason: reason,
      });
    if (affected === 0) return null;
    const row = await db('removal_requests').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'dismissAtomic' });
}

export async function findDueForApplication(asOf = new Date()) {
  return withDbErrors(async () => {
    const rows = await db('removal_requests')
      .where({ status: 'APPROVED' })
      .whereNull('applied_at')
      .where('removal_effective_at', '<=', asOf);
    return convertRows(rows);
  }, { ...CTX, method: 'findDueForApplication' });
}

export async function markAppliedAtomic(id, trx = db) {
  return withDbErrors(async () => {
    const affected = await trx('removal_requests')
      .where({ id, status: 'APPROVED' })
      .whereNull('applied_at')
      .update({ applied_at: new Date() });
    if (affected === 0) return null;
    const row = await trx('removal_requests').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'markAppliedAtomic' });
}

export async function listPending({ page = 1, pageSize = 25, reason = null } = {}) {
  return withDbErrors(async () => {
    const q = db('removal_requests').where('status', 'PENDING');
    if (reason) q.where('reason', reason);
    const [countRow] = await q.clone().count({ count: '*' });
    const total = Number(countRow.count);

    const offset = (Math.max(1, page) - 1) * pageSize;
    const rows = await q.clone().orderBy('created_at', 'asc').limit(pageSize).offset(offset);

    return { items: convertRows(rows), total };
  }, { ...CTX, method: 'listPending' });
}

export async function countPending() {
  return withDbErrors(async () => {
    const [row] = await db('removal_requests').where('status', 'PENDING').count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countPending' });
}

export async function countCreatedInWindow({ from, to }) {
  return withDbErrors(async () => {
    const q = db('removal_requests');
    if (from) q.where('created_at', '>=', from);
    if (to) q.where('created_at', '<=', to);
    const [row] = await q.count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countCreatedInWindow' });
}
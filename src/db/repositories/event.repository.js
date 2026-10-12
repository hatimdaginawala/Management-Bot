import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const CTX = { repository: 'event' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('events').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'findById' });
}

export async function findLatestByHost(hostDiscordId) {
  return withDbErrors(async () => {
    const row = await db('events')
      .where({ host_discord_id: hostDiscordId })
      .orderBy('cooldown_anchor', 'desc')
      .first();
    return convertRow(row);
  }, { ...CTX, method: 'findLatestByHost' });
}

export async function create(data) {
  return withDbErrors(async () => {
    const [id] = await db('events').insert({
      host_user_id: data.hostUserId ?? null,
      host_discord_id: data.hostDiscordId,
      host_discord_username: data.hostDiscordUsername ?? null,
      host_roblox_id: data.hostRobloxId ?? null,
      host_roblox_username: data.hostRobloxUsername ?? null,
      event_type_id: data.eventTypeId,
      event_type_key: data.eventTypeKey,
      proof_url: data.proofUrl,
      notes: data.notes ?? null,
      status: data.status ?? 'PENDING',
      created_by: data.createdBy,
      approved_by: data.approvedBy ?? null,
      approved_at: data.approvedAt ?? null,
      rejected_by: data.rejectedBy ?? null,
      rejected_at: data.rejectedAt ?? null,
      rejection_reason: data.rejectionReason ?? null,
      cancelled_by: data.cancelledBy ?? null,
      cancelled_at: data.cancelledAt ?? null,
      cancellation_reason: data.cancellationReason ?? null,
      cooldown_anchor: data.cooldownAnchor ?? new Date(),
    });
    const row = await db('events').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'create' });
}

export async function updateById(id, data) {
  return withDbErrors(async () => {
    const patch = {};
    if (data.proofUrl !== undefined) patch.proof_url = data.proofUrl;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.status !== undefined) patch.status = data.status;
    if (data.approvedBy !== undefined) patch.approved_by = data.approvedBy;
    if (data.approvedAt !== undefined) patch.approved_at = data.approvedAt;
    if (data.rejectedBy !== undefined) patch.rejected_by = data.rejectedBy;
    if (data.rejectedAt !== undefined) patch.rejected_at = data.rejectedAt;
    if (data.rejectionReason !== undefined) patch.rejection_reason = data.rejectionReason;
    if (data.cancelledBy !== undefined) patch.cancelled_by = data.cancelledBy;
    if (data.cancelledAt !== undefined) patch.cancelled_at = data.cancelledAt;
    if (data.cancellationReason !== undefined) patch.cancellation_reason = data.cancellationReason;

    if (Object.keys(patch).length > 0) {
      await db('events').where({ id }).update(patch);
    }
    const row = await db('events').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'updateById' });
}

export async function approveAtomic(id, { approvedBy, approvedAt = new Date() } = {}) {
  return withDbErrors(async () => {
    const affected = await db('events')
      .where({ id, status: 'PENDING' })
      .update({
        status: 'APPROVED',
        approved_by: approvedBy,
        approved_at: approvedAt,
      });
    if (affected === 0) return null;
    const row = await db('events').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'approveAtomic' });
}

export async function rejectAtomic(id, { rejectedBy, rejectedAt = new Date(), reason }) {
  return withDbErrors(async () => {
    const affected = await db('events')
      .where({ id, status: 'PENDING' })
      .update({
        status: 'REJECTED',
        rejected_by: rejectedBy,
        rejected_at: rejectedAt,
        rejection_reason: reason,
      });
    if (affected === 0) return null;
    const row = await db('events').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'rejectAtomic' });
}

export async function list({
  status,
  hostDiscordId,
  eventTypeKey,
  from,
  to,
  page = 1,
  pageSize = 25,
} = {}) {
  return withDbErrors(async () => {
    const q = db('events');
    if (status && status !== 'ANY') q.where('status', status);
    if (hostDiscordId) q.where('host_discord_id', hostDiscordId);
    if (eventTypeKey) q.where('event_type_key', eventTypeKey.toLowerCase());
    if (from) q.where('created_at', '>=', from);
    if (to) q.where('created_at', '<=', to);

    const [countRow] = await q.clone().count({ count: '*' });
    const total = Number(countRow.count);

    const offset = (Math.max(1, page) - 1) * pageSize;
    const rows = await q
      .clone()
      .orderBy('created_at', 'desc')
      .limit(pageSize)
      .offset(offset);

    return { items: convertRows(rows), total };
  }, { ...CTX, method: 'list' });
}

export async function countApprovedByHostInRange(hostDiscordId, { from, to }) {
  return withDbErrors(async () => {
    const [row] = await db('events')
      .where({ host_discord_id: hostDiscordId, status: 'APPROVED' })
      .where('cooldown_anchor', '>=', from)
      .where('cooldown_anchor', '<', to)
      .count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countApprovedByHostInRange' });
}

export async function countByTypeInRange({ from, to }) {
  return withDbErrors(async () => {
    const rows = await db('events')
      .where('status', 'APPROVED')
      .where('created_at', '>=', from)
      .where('created_at', '<=', to)
      .groupBy('event_type_key')
      .select('event_type_key')
      .count({ count: '*' });
    return rows.map((r) => ({ typeKey: r.event_type_key, count: Number(r.count) }));
  }, { ...CTX, method: 'countByTypeInRange' });
}

export async function countByStatusInRange({ from, to }) {
  return withDbErrors(async () => {
    const rows = await db('events')
      .where('created_at', '>=', from)
      .where('created_at', '<=', to)
      .groupBy('status')
      .select('status')
      .count({ count: '*' });
    const out = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }, { ...CTX, method: 'countByStatusInRange' });
}

export async function topHostsInRange({ from, to, limit = 10 }) {
  return withDbErrors(async () => {
    const rows = await db('events')
      .where('status', 'APPROVED')
      .where('created_at', '>=', from)
      .where('created_at', '<=', to)
      .groupBy('host_discord_id')
      .select('host_discord_id')
      .select(db.raw('MIN(host_discord_username) as host_discord_username'))
      .select(db.raw('MIN(host_roblox_username) as host_roblox_username'))
      .count({ count: '*' })
      .orderBy('count', 'desc')
      .limit(limit);
    return rows.map((r) => ({
      discordId: r.host_discord_id,
      discordUsername: r.host_discord_username,
      robloxUsername: r.host_roblox_username,
      count: Number(r.count),
    }));
  }, { ...CTX, method: 'topHostsInRange' });
}
import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const CTX = { repository: 'rankHistory' };

/**
 * Create a rank history entry (append-only).
 */
export async function create(data) {
  return withDbErrors(async () => {
    const [id] = await db('rank_history').insert({
      user_id: data.userId,
      discord_id: data.discordId,
      roblox_id: data.robloxId,
      old_rank_id: data.oldRank?.rankId ?? null,
      old_rank_name: data.oldRank?.rankName ?? null,
      old_rank_value: data.oldRank?.rankValue ?? null,
      new_rank_id: data.newRank?.rankId ?? null,
      new_rank_name: data.newRank?.rankName ?? null,
      new_rank_value: data.newRank?.rankValue ?? null,
      changed_at: data.changedAt ?? new Date(),
      source: data.source ?? 'SYNC',
      sync_log_id: data.syncLogId ?? null,
      note: data.note ?? null,
    });
    const row = await db('rank_history').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'create' });
}

/**
 * History for a single user (used by /rank history).
 */
export async function listForUser(userId, { limit = 25 } = {}) {
  return withDbErrors(async () => {
    const rows = await db('rank_history')
      .where({ user_id: userId })
      .orderBy('changed_at', 'desc')
      .limit(Math.min(200, Math.max(1, limit)));
    return convertRows(rows);
  }, { ...CTX, method: 'listForUser' });
}

/**
 * All rank changes observed during a specific sync.
 */
export async function listForSync(syncLogId) {
  return withDbErrors(async () => {
    const rows = await db('rank_history')
      .where({ sync_log_id: syncLogId })
      .orderBy('changed_at', 'asc');
    return convertRows(rows);
  }, { ...CTX, method: 'listForSync' });
}

/**
 * Count rank changes for a user.
 */
export async function countForUser(userId) {
  return withDbErrors(async () => {
    const [row] = await db('rank_history').where({ user_id: userId }).count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countForUser' });
}
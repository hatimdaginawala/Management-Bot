import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

/**
 * User repository.
 *
 * Every method returns plain JS objects (never MySQL row shapes).
 * Booleans are coerced to real booleans.
 */

const BOOLEAN_FIELDS = ['quota_exempt'];
const CTX = { repository: 'user' };

/**
 * Find one user by Discord ID.
 */
export async function findByDiscordId(discordId) {
  return withDbErrors(async () => {
    const row = await db('users').where({ discord_id: discordId }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findByDiscordId' });
}

/**
 * Find one user by Roblox ID.
 */
export async function findByRobloxId(robloxId) {
  return withDbErrors(async () => {
    const row = await db('users').where({ roblox_id: robloxId }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findByRobloxId' });
}

/**
 * Find one user by primary key.
 */
export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('users').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findById' });
}

/**
 * Find one user by exact Roblox username (case-insensitive).
 */
export async function findByRobloxUsername(robloxUsername) {
  return withDbErrors(async () => {
    const row = await db('users')
      .whereRaw('LOWER(roblox_username) = LOWER(?)', [robloxUsername])
      .first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findByRobloxUsername' });
}

/**
 * Create a new user. Returns the created row.
 */
export async function create(data) {
  return withDbErrors(async () => {
    const [id] = await db('users').insert({
      discord_id: data.discordId,
      discord_username: data.discordUsername ?? null,
      roblox_id: data.robloxId ?? null,
      roblox_username: data.robloxUsername ?? null,
      roblox_display_name: data.robloxDisplayName ?? null,
      roblox_rank_id: data.robloxRankId ?? null,
      roblox_rank_name: data.robloxRankName ?? null,
      roblox_rank_value: data.robloxRankValue ?? null,
      roblox_last_synced_at: data.robloxLastSyncedAt ?? null,
      status: data.status ?? 'UNVERIFIED',
      quota_exempt: data.quotaExempt ?? false,
      quota_exempt_until: data.quotaExemptUntil ?? null,
      quota_exempt_reason: data.quotaExemptReason ?? null,
      quota_category: data.quotaCategory ?? 'NONE',
      joined_at: data.joinedAt ?? new Date(),
      last_left_roblox_at: data.lastLeftRobloxAt ?? null,
      last_rejoined_roblox_at: data.lastRejoinedRobloxAt ?? null,
      last_unlinked_at: data.lastUnlinkedAt ?? null,
      suspended_at: data.suspendedAt ?? null,
      suspension_reason: data.suspensionReason ?? null,
    });
    const row = await db('users').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'create' });
}

/**
 * Update fields on a user by ID. Only the keys present in `data` are
 * written (patch semantics). Returns the updated row, or null if the
 * user does not exist.
 */
export async function updateById(id, data) {
  return withDbErrors(async () => {
    const patch = mapToColumns(data);
    if (Object.keys(patch).length === 0) {
      const existing = await db('users').where({ id }).first();
      return convertRow(existing, { booleanFields: BOOLEAN_FIELDS });
    }
    await db('users').where({ id }).update(patch);
    const row = await db('users').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'updateById' });
}

/**
 * Update fields on a user by Discord ID.
 */
export async function updateByDiscordId(discordId, data) {
  return withDbErrors(async () => {
    const patch = mapToColumns(data);
    if (Object.keys(patch).length === 0) {
      const existing = await db('users').where({ discord_id: discordId }).first();
      return convertRow(existing, { booleanFields: BOOLEAN_FIELDS });
    }
    await db('users').where({ discord_id: discordId }).update(patch);
    const row = await db('users').where({ discord_id: discordId }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'updateByDiscordId' });
}

/**
 * Count users matching an optional filter.
 */
export async function count(filter = {}) {
  return withDbErrors(async () => {
    const q = db('users');
    applyUserFilter(q, filter);
    const [row] = await q.count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'count' });
}

/**
 * List users with filtering + pagination.
 * Returns { items, total }.
 */
export async function list({
  status,
  roleKey,
  quotaCategory,
  robloxRankId,
  robloxRankName,
  hasStrikes,
  onLeave,
  search,
  page = 1,
  pageSize = 25,
} = {}) {
  return withDbErrors(async () => {
    const baseQuery = db('users');

    applyUserFilter(baseQuery, {
      status,
      quotaCategory,
      robloxRankId,
      robloxRankName,
      search,
    });

    // Optional subquery filters
    if (roleKey) {
      baseQuery.whereIn(
        'users.id',
        db('role_assignments')
          .select('user_id')
          .where({ role_key: roleKey, active: true })
      );
    }

    if (typeof hasStrikes === 'boolean') {
      const subquery = db('strikes').select('user_id').where({ status: 'ACTIVE' });
      if (hasStrikes) baseQuery.whereIn('users.id', subquery);
      else baseQuery.whereNotIn('users.id', subquery);
    }

    if (typeof onLeave === 'boolean') {
      const now = new Date();
      const subquery = db('leaves')
        .select('user_id')
        .where({ status: 'APPROVED' })
        .where('start_at', '<=', now)
        .where('end_at', '>=', now);
      if (onLeave) baseQuery.whereIn('users.id', subquery);
      else baseQuery.whereNotIn('users.id', subquery);
    }

    const [countRow] = await baseQuery.clone().count({ count: '*' });
    const total = Number(countRow.count);

    const offset = (Math.max(1, page) - 1) * pageSize;
    const rows = await baseQuery
      .clone()
      .orderBy([{ column: 'roblox_rank_value', order: 'desc' }, { column: 'discord_username', order: 'asc' }])
      .limit(pageSize)
      .offset(offset);

    return {
      items: convertRows(rows, { booleanFields: BOOLEAN_FIELDS }),
      total,
    };
  }, { ...CTX, method: 'list' });
}

/**
 * Fetch multiple users by an array of IDs.
 * Returns a Map<number, user>.
 */
export async function findByIds(ids) {
  if (!ids || ids.length === 0) return new Map();
  return withDbErrors(async () => {
    const rows = await db('users').whereIn('id', ids);
    const map = new Map();
    for (const r of convertRows(rows, { booleanFields: BOOLEAN_FIELDS })) {
      map.set(r.id, r);
    }
    return map;
  }, { ...CTX, method: 'findByIds' });
}

/**
 * Bulk update the quota_category field for many users.
 * Used by the RBAC recompute path.
 */
export async function bulkUpdateQuotaCategory(userIds, category) {
  if (!userIds || userIds.length === 0) return 0;
  return withDbErrors(async () => {
    const affected = await db('users')
      .whereIn('id', userIds)
      .update({ quota_category: category });
    return affected;
  }, { ...CTX, method: 'bulkUpdateQuotaCategory' });
}

// ============================================================
//  Internal — filter helpers
// ============================================================

function applyUserFilter(q, {
  status,
  quotaCategory,
  robloxRankId,
  robloxRankName,
  search,
} = {}) {
  if (status && status !== 'ANY') q.where('status', status);
  if (quotaCategory) q.where('quota_category', quotaCategory);
  if (typeof robloxRankId === 'number') q.where('roblox_rank_id', robloxRankId);
  if (robloxRankName) q.where('roblox_rank_name', robloxRankName);
  if (search) {
    const like = `%${search}%`;
    q.where((builder) => {
      builder
        .where('discord_username', 'like', like)
        .orWhere('roblox_username', 'like', like)
        .orWhere('roblox_display_name', 'like', like);
    });
  }
}

/**
 * Map camelCase JS keys to snake_case DB columns.
 * Only keys present in `data` are written; others are left untouched.
 */
function mapToColumns(data) {
  const map = {
    discordId: 'discord_id',
    discordUsername: 'discord_username',
    robloxId: 'roblox_id',
    robloxUsername: 'roblox_username',
    robloxDisplayName: 'roblox_display_name',
    robloxRankId: 'roblox_rank_id',
    robloxRankName: 'roblox_rank_name',
    robloxRankValue: 'roblox_rank_value',
    robloxLastSyncedAt: 'roblox_last_synced_at',
    status: 'status',
    quotaExempt: 'quota_exempt',
    quotaExemptUntil: 'quota_exempt_until',
    quotaExemptReason: 'quota_exempt_reason',
    quotaCategory: 'quota_category',
    joinedAt: 'joined_at',
    lastLeftRobloxAt: 'last_left_roblox_at',
    lastRejoinedRobloxAt: 'last_rejoined_roblox_at',
    lastUnlinkedAt: 'last_unlinked_at',
    suspendedAt: 'suspended_at',
    suspensionReason: 'suspension_reason',
  };
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (map[k] !== undefined) out[map[k]] = v;
  }
  return out;
}
export async function countByStatus() {
  return withDbErrors(async () => {
    const rows = await db('users').groupBy('status').select('status').count({ count: '*' });
    return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  }, { repository: 'user', method: 'countByStatus' });
}

export async function countByQuotaCategory() {
  return withDbErrors(async () => {
    const rows = await db('users').groupBy('quota_category').select('quota_category').count({ count: '*' });
    return rows.map((r) => ({ category: r.quota_category, count: Number(r.count) }));
  }, { repository: 'user', method: 'countByQuotaCategory' });
}

export async function countByRobloxRankName({ limit = 20 } = {}) {
  return withDbErrors(async () => {
    const rows = await db('users')
      .whereNotNull('roblox_rank_name')
      .groupBy('roblox_rank_name')
      .select('roblox_rank_name')
      .count({ count: '*' })
      .orderBy('count', 'desc')
      .limit(limit);
    return rows.map((r) => ({ rankName: r.roblox_rank_name, count: Number(r.count) }));
  }, { repository: 'user', method: 'countByRobloxRankName' });
}
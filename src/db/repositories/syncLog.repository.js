import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const JSON_FIELDS = ['captured_errors'];
const CTX = { repository: 'syncLog' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('sync_logs').where({ id }).first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'findById' });
}

/**
 * Find the most recent sync by type.
 */
export async function findLatest(type = 'ROBLOX_GROUP_SYNC') {
  return withDbErrors(async () => {
    const row = await db('sync_logs')
      .where({ type })
      .orderBy('started_at', 'desc')
      .first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'findLatest' });
}

/**
 * Check whether a sync is currently RUNNING for a given type.
 * Replaces the MongoDB partial unique index ("one RUNNING per type").
 */
export async function findRunning(type = 'ROBLOX_GROUP_SYNC') {
  return withDbErrors(async () => {
    const row = await db('sync_logs')
      .where({ type, status: 'RUNNING' })
      .orderBy('started_at', 'desc')
      .first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'findRunning' });
}

/**
 * Create a new sync log entry. Returns the created row.
 */
export async function create(data) {
  return withDbErrors(async () => {
    const [id] = await db('sync_logs').insert({
      type: data.type ?? 'ROBLOX_GROUP_SYNC',
      triggered_by: data.triggeredBy ?? 'system',
      started_at: data.startedAt ?? new Date(),
      completed_at: null,
      status: 'RUNNING',
      members_fetched: 0,
      members_created: 0,
      members_updated: 0,
      rank_changes: 0,
      members_removed: 0,
      captured_errors: JSON.stringify([]),
      summary: null,
    });
    const row = await db('sync_logs').where({ id }).first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'create' });
}

/**
 * Finalize a sync log with counters and status.
 */
export async function finalize(id, {
  status,
  counts,
  errors = [],
  summary = null,
}) {
  return withDbErrors(async () => {
    await db('sync_logs').where({ id }).update({
      status,
      completed_at: new Date(),
      members_fetched: counts.membersFetched ?? 0,
      members_created: counts.membersCreated ?? 0,
      members_updated: counts.membersUpdated ?? 0,
      rank_changes: counts.rankChanges ?? 0,
      members_removed: counts.membersRemoved ?? 0,
      captured_errors: JSON.stringify(errors.slice(0, 50)),
      summary,
    });
    const row = await db('sync_logs').where({ id }).first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'finalize' });
}

/**
 * Recent syncs.
 */
export async function listRecent({ type = 'ROBLOX_GROUP_SYNC', limit = 10 } = {}) {
  return withDbErrors(async () => {
    const rows = await db('sync_logs')
      .where({ type })
      .orderBy('started_at', 'desc')
      .limit(limit);
    return convertRows(rows, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'listRecent' });
}

/**
 * Aggregate counters across successful / partial syncs in a window.
 */
export async function aggregateInWindow({ from, to, type = 'ROBLOX_GROUP_SYNC' } = {}) {
  return withDbErrors(async () => {
    const q = db('sync_logs')
      .where({ type })
      .whereIn('status', ['SUCCESS', 'PARTIAL']);
    if (from) q.where('started_at', '>=', from);
    if (to) q.where('started_at', '<', to);

    const [row] = await q
      .count({ syncCount: '*' })
      .sum({
        membersFetched: 'members_fetched',
        membersCreated: 'members_created',
        membersUpdated: 'members_updated',
        rankChanges: 'rank_changes',
        membersRemoved: 'members_removed',
      });

    return {
      syncCount: Number(row.syncCount || 0),
      membersFetched: Number(row.membersFetched || 0),
      membersCreated: Number(row.membersCreated || 0),
      membersUpdated: Number(row.membersUpdated || 0),
      rankChanges: Number(row.rankChanges || 0),
      membersRemoved: Number(row.membersRemoved || 0),
    };
  }, { ...CTX, method: 'aggregateInWindow' });
}
import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const BOOLEAN_FIELDS = ['counts_for_quota', 'active', 'is_deletable'];
const CTX = { repository: 'eventType' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('event_types').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findById' });
}

export async function findByKey(key) {
  return withDbErrors(async () => {
    const row = await db('event_types')
      .whereRaw('`key` = ?', [key.toLowerCase()])
      .first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findByKey' });
}

export async function list({ includeInactive = false } = {}) {
  return withDbErrors(async () => {
    const q = db('event_types');
    if (!includeInactive) q.where('active', true);
    const rows = await q.orderBy([
      { column: 'sort_order', order: 'asc' },
      { column: 'name', order: 'asc' },
    ]);
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'list' });
}

export async function listActiveKeys() {
  return withDbErrors(async () => {
    const rows = await db('event_types').where('active', true).select('key');
    return rows.map((r) => r.key);
  }, { ...CTX, method: 'listActiveKeys' });
}

export async function create(data) {
  return withDbErrors(async () => {
    const [id] = await db('event_types').insert({
      key: data.key.toLowerCase(),
      name: data.name,
      description: data.description ?? '',
      counts_for_quota: data.countsForQuota ?? true,
      active: data.active ?? true,
      sort_order: data.sortOrder ?? 0,
      created_by: data.createdBy ?? 'system',
      is_deletable: data.isDeletable ?? true,
    });
    const row = await db('event_types').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'create' });
}

export async function updateById(id, data) {
  return withDbErrors(async () => {
    const patch = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.countsForQuota !== undefined) patch.counts_for_quota = data.countsForQuota;
    if (data.active !== undefined) patch.active = data.active;
    if (data.sortOrder !== undefined) patch.sort_order = data.sortOrder;

    if (Object.keys(patch).length > 0) {
      await db('event_types').where({ id }).update(patch);
    }
    const row = await db('event_types').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'updateById' });
}

export async function upsert(data) {
  return withDbErrors(async () => {
    const existing = await db('event_types')
      .whereRaw('`key` = ?', [data.key.toLowerCase()])
      .first();
    if (!existing) return create(data);
    return convertRow(existing, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'upsert' });
}
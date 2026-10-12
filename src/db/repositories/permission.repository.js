import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const BOOLEAN_FIELDS = ['is_wildcard'];
const CTX = { repository: 'permission' };

export async function findByKey(key) {
  return withDbErrors(async () => {
    const row = await db('permissions').where({ key }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findByKey' });
}

export async function list() {
  return withDbErrors(async () => {
    const rows = await db('permissions')
      .orderBy([{ column: 'category', order: 'asc' }, { column: 'key', order: 'asc' }]);
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'list' });
}

/**
 * Upsert a permission. Used by the seed script.
 * Returns the row after upsert.
 */
export async function upsert(data) {
  return withDbErrors(async () => {
    const existing = await db('permissions').where({ key: data.key }).first();
    if (!existing) {
      await db('permissions').insert({
        key: data.key,
        label: data.label,
        description: data.description ?? '',
        category: data.category,
        is_wildcard: data.isWildcard ?? false,
      });
    } else {
      await db('permissions').where({ key: data.key }).update({
        label: data.label,
        description: data.description ?? '',
        category: data.category,
      });
    }
    const row = await db('permissions').where({ key: data.key }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'upsert' });
}

/**
 * Return the flat list of all permission keys.
 * Used by the permission resolver for wildcard expansion.
 */
export async function getAllKeys() {
  return withDbErrors(async () => {
    const rows = await db('permissions').select('key');
    return rows.map((r) => r.key);
  }, { ...CTX, method: 'getAllKeys' });
}
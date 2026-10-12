import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const BOOLEAN_FIELDS = ['is_permanent', 'is_editable', 'is_deletable', 'active'];
const JSON_FIELDS = ['permissions'];
const CTX = { repository: 'role' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('roles').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS, jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'findById' });
}

export async function findByKey(key) {
  return withDbErrors(async () => {
    const row = await db('roles').whereRaw('`key` = ?', [key.toLowerCase()]).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS, jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'findByKey' });
}

/**
 * List roles, sorted by priority desc.
 */
export async function list({ includeInactive = false } = {}) {
  return withDbErrors(async () => {
    const q = db('roles');
    if (!includeInactive) q.where('active', true);
    const rows = await q.orderBy([{ column: 'priority', order: 'desc' }, { column: 'name', order: 'asc' }]);
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS, jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'list' });
}

export async function create(data) {
  return withDbErrors(async () => {
    const [id] = await db('roles').insert({
      key: data.key.toLowerCase(),
      name: data.name,
      description: data.description ?? '',
      permissions: JSON.stringify(data.permissions ?? []),
      priority: data.priority ?? 0,
      quota_category: data.quotaCategory ?? 'NONE',
      kind: data.kind ?? 'CUSTOM',
      is_permanent: data.isPermanent ?? false,
      is_editable: data.isEditable ?? true,
      is_deletable: data.isDeletable ?? true,
      active: data.active ?? true,
      created_by: data.createdBy ?? 'system',
    });
    const row = await db('roles').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS, jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'create' });
}

export async function updateById(id, data) {
  return withDbErrors(async () => {
    const patch = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.permissions !== undefined) patch.permissions = JSON.stringify(data.permissions);
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.quotaCategory !== undefined) patch.quota_category = data.quotaCategory;
    if (data.active !== undefined) patch.active = data.active;

    if (Object.keys(patch).length > 0) {
      await db('roles').where({ id }).update(patch);
    }
    const row = await db('roles').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS, jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'updateById' });
}

/**
 * Hard-delete a role.
 * FKs on role_assignments will RESTRICT if any assignment exists
 * (active or historical), so callers must remove assignments first.
 */
export async function deleteById(id) {
  return withDbErrors(async () => {
    const affected = await db('roles').where({ id }).delete();
    return affected > 0;
  }, { ...CTX, method: 'deleteById' });
}

/**
 * Count active assignments on a role.
 */
export async function countActiveAssignments(roleId) {
  return withDbErrors(async () => {
    const [row] = await db('role_assignments')
      .where({ role_id: roleId, active: true })
      .count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countActiveAssignments' });
}

/**
 * Find the highest-priority role(s) held by a user.
 * Returns null if the user has no active roles.
 */
export async function findHighestPriorityForUser(userId) {
  return withDbErrors(async () => {
    const row = await db('roles as r')
      .join('role_assignments as ra', 'ra.role_id', 'r.id')
      .where('ra.user_id', userId)
      .where('ra.active', true)
      .orderBy('r.priority', 'desc')
      .select('r.*')
      .first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS, jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'findHighestPriorityForUser' });
}
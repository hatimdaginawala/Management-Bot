import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const BOOLEAN_FIELDS = ['active'];
const CTX = { repository: 'roleAssignment' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('role_assignments').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findById' });
}

/**
 * Return all active assignments for a user, each joined with its role.
 * Row shape: { ...assignment fields..., role_* fields from roles }.
 */
export async function findActiveForUser(userId) {
  return withDbErrors(async () => {
    const rows = await db('role_assignments as ra')
      .leftJoin('roles as r', 'r.id', 'ra.role_id')
      .where('ra.user_id', userId)
      .where('ra.active', true)
      .select(
        'ra.*',
        'r.id as role_db_id',
        'r.key as role_db_key',
        'r.name as role_db_name',
        'r.description as role_db_description',
        'r.permissions as role_db_permissions',
        'r.priority as role_db_priority',
        'r.quota_category as role_db_quota_category',
        'r.kind as role_db_kind',
        'r.is_permanent as role_db_is_permanent',
        'r.is_editable as role_db_is_editable',
        'r.is_deletable as role_db_is_deletable',
        'r.active as role_db_active'
      );
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findActiveForUser' });
}

export async function findActiveByUserAndRole(userId, roleId) {
  return withDbErrors(async () => {
    const row = await db('role_assignments')
      .where({ user_id: userId, role_id: roleId, active: true })
      .first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findActiveByUserAndRole' });
}

export async function findInactiveByUserAndRole(userId, roleId) {
  return withDbErrors(async () => {
    const row = await db('role_assignments')
      .where({ user_id: userId, role_id: roleId, active: false })
      .orderBy('removed_at', 'desc')
      .first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findInactiveByUserAndRole' });
}

export async function create(data) {
  return withDbErrors(async () => {
    const [id] = await db('role_assignments').insert({
      user_id: data.userId,
      discord_id: data.discordId,
      role_id: data.roleId,
      role_key: data.roleKey,
      assigned_by: data.assignedBy ?? 'system',
      assigned_at: data.assignedAt ?? new Date(),
      removed_at: null,
      removed_by: null,
      reason: data.reason ?? null,
      active: data.active ?? true,
    });
    const row = await db('role_assignments').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'create' });
}

/**
 * Atomic insert-if-not-exists for active assignments.
 * Equivalent to the partial-unique index + upsert pattern.
 *
 * Uses INSERT ... SELECT ... WHERE NOT EXISTS so two concurrent calls
 * cannot both insert. Returns the (existing or newly created) row, or
 * null if a race prevented insertion (shouldn't happen with the
 * SELECT guard).
 */
export async function ensureActive(data) {
  return withDbErrors(async () => {
    // 1. Check whether an active row exists.
    const existing = await db('role_assignments')
      .where({ user_id: data.userId, role_id: data.roleId, active: true })
      .first();
    if (existing) return convertRow(existing, { booleanFields: BOOLEAN_FIELDS });

    // 2. Try reactivating a previously removed row.
    const reactivated = await db('role_assignments')
      .where({ user_id: data.userId, role_id: data.roleId, active: false })
      .orderBy('removed_at', 'desc')
      .first();

    if (reactivated) {
      await db('role_assignments')
        .where({ id: reactivated.id })
        .update({
          active: true,
          assigned_by: data.assignedBy ?? 'system',
          assigned_at: new Date(),
          removed_at: null,
          removed_by: null,
          reason: data.reason ?? null,
        });
      const row = await db('role_assignments').where({ id: reactivated.id }).first();
      return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
    }

    // 3. Insert a brand-new row.
    const [id] = await db('role_assignments').insert({
      user_id: data.userId,
      discord_id: data.discordId,
      role_id: data.roleId,
      role_key: data.roleKey,
      assigned_by: data.assignedBy ?? 'system',
      assigned_at: new Date(),
      active: true,
      reason: data.reason ?? null,
    });
    const row = await db('role_assignments').where({ id }).first();
    return convertRow(row, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'ensureActive' });
}

/**
 * Deactivate an active assignment.
 * Returns the number of rows affected (0 or 1).
 */
export async function deactivate(userId, roleId, { removedBy = 'system', reason = null } = {}) {
  return withDbErrors(async () => {
    const affected = await db('role_assignments')
      .where({ user_id: userId, role_id: roleId, active: true })
      .update({
        active: false,
        removed_at: new Date(),
        removed_by: removedBy,
        reason,
      });
    return affected;
  }, { ...CTX, method: 'deactivate' });
}

/**
 * Count active assignments on a role.
 */
export async function countActiveByRole(roleId) {
  return withDbErrors(async () => {
    const [row] = await db('role_assignments')
      .where({ role_id: roleId, active: true })
      .count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countActiveByRole' });
}

/**
 * Return all active assignments for a role, with the user row joined.
 */
export async function findActiveByRole(roleId) {
  return withDbErrors(async () => {
    const rows = await db('role_assignments as ra')
      .join('users as u', 'u.id', 'ra.user_id')
      .where('ra.role_id', roleId)
      .where('ra.active', true)
      .select('ra.*', 'u.id as user_db_id', 'u.discord_id as user_db_discord_id');
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'findActiveByRole' });
}

export async function countActiveByRoleKey() {
  return withDbErrors(async () => {
    const rows = await db('role_assignments')
      .where('active', true)
      .groupBy('role_key')
      .select('role_key')
      .count({ count: '*' })
      .orderBy('count', 'desc');
    return rows.map((r) => ({ roleKey: r.role_key, count: Number(r.count) }));
  }, { repository: 'roleAssignment', method: 'countActiveByRoleKey' });
}
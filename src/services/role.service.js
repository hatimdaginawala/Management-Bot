import * as roleRepo from '../db/repositories/role.repository.js';
import * as userRepo from '../db/repositories/user.repository.js';
import * as roleAssignmentRepo from '../db/repositories/roleAssignment.repository.js';
import { audit } from '../utils/audit.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AuthorizationError,
} from '../utils/errors.js';
import {
  assertCanManageRoleByDiscordId,
  getHighestPriority,
  getHighestPriorityByDiscordId,
} from './permission.service.js';
import logger from '../config/logger.js';

/**
 * Role service. Public API is unchanged from the Mongoose version.
 */

// ---------- Reads ----------

export async function listRoles({ includeInactive = false } = {}) {
  return roleRepo.list({ includeInactive });
}

export async function getRoleByKey(key) {
  const role = await roleRepo.findByKey(key);
  if (!role) throw new NotFoundError('Role', { key });
  return role;
}

export async function getRoleById(id) {
  const role = await roleRepo.findById(id);
  if (!role) throw new NotFoundError('Role', { id: String(id) });
  return role;
}

// ---------- Creates ----------

export async function createRole(actorId, payload) {
  const {
    key,
    name,
    description = '',
    permissions = [],
    priority,
    quotaCategory = 'NONE',
  } = payload;

  if (!key || !/^[a-z][a-z0-9_]{1,40}$/.test(key)) {
    throw new ValidationError(
      'Role key must be lowercase, start with a letter, and be 2–41 chars (a-z, 0-9, _).'
    );
  }
  if (!name || name.length > 80) {
    throw new ValidationError('Role name is required and must be ≤ 80 chars.');
  }
  if (typeof priority !== 'number' || priority < 0 || priority > 999) {
    throw new ValidationError('Priority must be a number between 0 and 999.');
  }
  if (!['NONE', 'STAFF', 'LOW_RANK'].includes(quotaCategory)) {
    throw new ValidationError('quotaCategory must be one of NONE, STAFF, LOW_RANK.');
  }

  const { priority: actorPriority, role: actorTop } =
    await getHighestPriorityByDiscordId(actorId);
  if (actorTop?.is_permanent !== true && priority >= actorPriority) {
    throw new AuthorizationError(
      'You cannot create a role with priority ≥ your own highest role.'
    );
  }

  validatePermissionsShape(permissions);

  const existing = await roleRepo.findByKey(key);
  if (existing) throw new ConflictError('Role key "' + key + '" already exists.');

  const role = await roleRepo.create({
    key: key.toLowerCase(),
    name,
    description,
    permissions,
    priority,
    quotaCategory,
    kind: 'CUSTOM',
    isPermanent: false,
    isEditable: true,
    isDeletable: true,
    active: true,
    createdBy: actorId,
  });

  await audit({
    actorId,
    action: 'role.created',
    category: 'ROLE',
    targetType: 'Role',
    targetId: role.id,
    after: role,
  });

  logger.info({ actorId, roleKey: role.key }, 'Role created');
  return role;
}

// ---------- Updates ----------

export async function editRole(actorId, key, patch) {
  const role = await roleRepo.findByKey(key);
  if (!role) throw new NotFoundError('Role', { key });

  if (!role.is_editable) {
    throw new AuthorizationError('Role "' + role.key + '" is not editable.');
  }
  await assertCanManageRoleByDiscordId(actorId, role);

  const before = { ...role };
  const updates = {};

  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string' || patch.name.length > 80) {
      throw new ValidationError('Role name must be a string of ≤ 80 chars.');
    }
    updates.name = patch.name;
  }
  if (patch.description !== undefined) {
    if (typeof patch.description !== 'string' || patch.description.length > 500) {
      throw new ValidationError('Description must be ≤ 500 chars.');
    }
    updates.description = patch.description;
  }
  if (patch.permissions !== undefined) {
    validatePermissionsShape(patch.permissions);
    updates.permissions = patch.permissions;
  }
  if (patch.priority !== undefined) {
    if (typeof patch.priority !== 'number' || patch.priority < 0 || patch.priority > 999) {
      throw new ValidationError('Priority must be 0–999.');
    }
    const { priority: actorPriority, role: actorTop } =
      await getHighestPriorityByDiscordId(actorId);
    if (actorTop?.is_permanent !== true && patch.priority >= actorPriority) {
      throw new AuthorizationError(
        'You cannot set a role priority ≥ your own highest role.'
      );
    }
    updates.priority = patch.priority;
  }
  if (patch.quotaCategory !== undefined) {
    if (!['NONE', 'STAFF', 'LOW_RANK'].includes(patch.quotaCategory)) {
      throw new ValidationError('quotaCategory must be one of NONE, STAFF, LOW_RANK.');
    }
    updates.quotaCategory = patch.quotaCategory;
  }
  if (patch.active !== undefined) {
    if (role.is_permanent) {
      throw new AuthorizationError('Permanent roles cannot be deactivated.');
    }
    updates.active = Boolean(patch.active);
  }

  if (Object.keys(updates).length === 0) return role;

  const updated = await roleRepo.updateById(role.id, updates);

  await audit({
    actorId,
    action: 'role.edited',
    category: 'ROLE',
    targetType: 'Role',
    targetId: role.id,
    before,
    after: updated,
  });

  if (
    updates.quotaCategory !== undefined &&
    updates.quotaCategory !== before.quota_category
  ) {
    logger.info(
      { roleKey: role.key, from: before.quota_category, to: updates.quotaCategory },
      'quotaCategory changed — caller should recompute affected users'
    );
  }

  return updated;
}

// ---------- Deletes ----------

export async function deleteRole(actorId, key) {
  const role = await roleRepo.findByKey(key);
  if (!role) throw new NotFoundError('Role', { key });

  if (!role.is_deletable) {
    throw new AuthorizationError('Role "' + role.key + '" is protected and cannot be deleted.');
  }
  await assertCanManageRoleByDiscordId(actorId, role);

  const activeCount = await roleRepo.countActiveAssignments(role.id);
  if (activeCount > 0) {
    throw new ConflictError(
      'Cannot delete role "' + role.key + '" — ' + activeCount +
      ' active assignment(s) exist. Remove them first.'
    );
  }

  const before = { ...role };
  await roleRepo.deleteById(role.id);

  await audit({
    actorId,
    action: 'role.deleted',
    category: 'ROLE',
    targetType: 'Role',
    targetId: before.id,
    before,
  });

  return before;
}

// ---------- Assignment ----------

export async function assignRole(actorId, discordId, roleKey, { reason = null } = {}) {
  const [user, role] = await Promise.all([
    userRepo.findByDiscordId(discordId),
    roleRepo.findByKey(roleKey),
  ]);
  if (!user) throw new NotFoundError('User', { discordId });
  if (!role || !role.active) throw new NotFoundError('Role', { key: roleKey });

  await assertCanManageRoleByDiscordId(actorId, role);

  // Actor must also outrank the target's current highest role.
  const { priority: targetPriority, role: targetTop } =
    await getHighestPriority(user.id);
  if (targetTop && targetTop.is_permanent !== true) {
    const { priority: actorPriority, role: actorTop } =
      await getHighestPriorityByDiscordId(actorId);
    if (
      actorTop?.is_permanent !== true &&
      actorPriority <= targetPriority &&
      actorId !== discordId
    ) {
      throw new AuthorizationError(
        'You cannot modify roles for a user at or above your priority level.'
      );
    }
  }

  // Idempotent check + reactivate-or-insert.
  const existingActive = await roleAssignmentRepo.findActiveByUserAndRole(user.id, role.id);
  if (existingActive) {
    logger.debug({ discordId, roleKey: role.key }, 'Role already assigned — no-op');
    return { assigned: false, role: role.key, discordId };
  }

  await roleAssignmentRepo.ensureActive({
    userId: user.id,
    discordId: user.discord_id,
    roleId: role.id,
    roleKey: role.key,
    assignedBy: actorId,
    reason,
  });

  await audit({
    actorId,
    action: 'role.assigned',
    category: 'ROLE',
    targetType: 'User',
    targetId: user.id,
    after: { discordId, roleKey: role.key },
    reason,
  });

  return { assigned: true, role: role.key, discordId };
}

export async function removeRole(actorId, discordId, roleKey, { reason = null } = {}) {
  const [user, role] = await Promise.all([
    userRepo.findByDiscordId(discordId),
    roleRepo.findByKey(roleKey),
  ]);
  if (!user) throw new NotFoundError('User', { discordId });
  if (!role) throw new NotFoundError('Role', { key: roleKey });

  await assertCanManageRoleByDiscordId(actorId, role);

  const removed = await roleAssignmentRepo.deactivate(user.id, role.id, {
    removedBy: actorId,
    reason,
  });

  if (removed === 0) {
    return { removed: false, role: role.key, discordId };
  }

  await audit({
    actorId,
    action: 'role.removed',
    category: 'ROLE',
    targetType: 'User',
    targetId: user.id,
    before: { discordId, roleKey: role.key },
    reason,
  });

  return { removed: true, role: role.key, discordId };
}

// ---------- Helpers ----------

function validatePermissionsShape(permissions) {
  if (!Array.isArray(permissions)) {
    throw new ValidationError('Permissions must be an array of strings.');
  }
  for (const p of permissions) {
    if (typeof p !== 'string' || p.length === 0 || p.length > 60) {
      throw new ValidationError('Invalid permission entry: ' + JSON.stringify(p));
    }
    if (!/^(\*|[a-z][a-z0-9_]*(\.[a-z0-9_]+|\.[a-z0-9_*]+)?)$/.test(p)) {
      throw new ValidationError('Permission has invalid format: ' + p);
    }
  }
}
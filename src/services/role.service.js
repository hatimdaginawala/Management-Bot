import { Role, RoleAssignment, User } from '../models/index.js';
import { Permission } from '../models/index.js';
import { audit } from '../utils/audit.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AuthorizationError,
} from '../utils/errors.js';
import {
  assertCanManageRoleByDiscordId,
  getHighestPriority,            // for target user (ObjectId)
  getHighestPriorityByDiscordId, // for actor (Discord ID)
} from './permission.service.js';
import logger from '../config/logger.js';

/**
 * Role service.
 * Every mutating operation writes an audit entry.
 * Every operation that touches an existing role enforces
 * priority via `assertCanManageRoleByDiscordId`.
 */

// ---------- Reads ----------

export async function listRoles({ includeInactive = false } = {}) {
  const filter = includeInactive ? {} : { active: true };
  return Role.find(filter).sort({ priority: -1, name: 1 }).lean();
}

export async function getRoleByKey(key) {
  const role = await Role.findOne({ key: key.toLowerCase() }).lean();
  if (!role) throw new NotFoundError('Role', { key });
  return role;
}

export async function getRoleById(id) {
  const role = await Role.findById(id).lean();
  if (!role) throw new NotFoundError('Role', { id: String(id) });
  return role;
}

// ---------- Creates ----------

/**
 * Create a new custom role.
 * - key must be unique
 * - priority must be strictly LESS THAN the actor's own highest priority
 *   (you cannot create a role above your own level)
 */
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
    throw new ValidationError(
      'quotaCategory must be one of NONE, STAFF, LOW_RANK.'
    );
  }

  // Actor must outrank the role they're creating.
  const { priority: actorPriority, role: actorTop } =
    await getHighestPriorityByDiscordId(actorId);
  if (actorTop?.isPermanent !== true && priority >= actorPriority) {
    throw new AuthorizationError(
      'You cannot create a role with priority ≥ your own highest role.'
    );
  }

  // Validate permissions against the catalog (wildcards allowed).
  validatePermissionsShape(permissions);

  const existing = await Role.findOne({ key: key.toLowerCase() });
  if (existing) throw new ConflictError(`Role key "${key}" already exists.`);

  const role = await Role.create({
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
    targetId: role._id,
    after: role.toObject(),
  });

  logger.info({ actorId, roleKey: role.key }, 'Role created');
  return role;
}

// ---------- Updates ----------

/**
 * Edit an existing role.
 * System roles can be edited (per §51) EXCEPT `isEditable: false` roles
 * (only super_admin).
 * Priority may not be raised to ≥ the actor's own priority.
 */
export async function editRole(actorId, key, patch) {
  const role = await Role.findOne({ key: key.toLowerCase() });
  if (!role) throw new NotFoundError('Role', { key });

  if (!role.isEditable) {
    throw new AuthorizationError(`Role "${role.key}" is not editable.`);
  }
  await assertCanManageRoleByDiscordId(actorId, role);

  const before = role.toObject();
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
    if (actorTop?.isPermanent !== true && patch.priority >= actorPriority) {
      throw new AuthorizationError(
        'You cannot set a role priority ≥ your own highest role.'
      );
    }
    updates.priority = patch.priority;
  }
  if (patch.quotaCategory !== undefined) {
    if (!['NONE', 'STAFF', 'LOW_RANK'].includes(patch.quotaCategory)) {
      throw new ValidationError(
        'quotaCategory must be one of NONE, STAFF, LOW_RANK.'
      );
    }
    updates.quotaCategory = patch.quotaCategory;
  }
  if (patch.active !== undefined) {
    if (role.isPermanent) {
      throw new AuthorizationError('Permanent roles cannot be deactivated.');
    }
    updates.active = Boolean(patch.active);
  }

  if (Object.keys(updates).length === 0) return role;

  Object.assign(role, updates);
  await role.save();

  await audit({
    actorId,
    action: 'role.edited',
    category: 'ROLE',
    targetType: 'Role',
    targetId: role._id,
    before,
    after: role.toObject(),
  });

  // If quotaCategory changed, users holding this role may need their
  // cached User.quota.category recomputed. Phase 3 does not do this
  // automatically — a follow-up call to user.service.recomputeQuotaCategory
  // is issued by the caller (the command handler).
  if (updates.quotaCategory && updates.quotaCategory !== before.quotaCategory) {
    logger.info(
      { roleKey: role.key, from: before.quotaCategory, to: updates.quotaCategory },
      'quotaCategory changed — caller should recompute affected users'
    );
  }

  return role;
}

// ---------- Deletes ----------

/**
 * Delete a role. Only `isDeletable: true` roles may be deleted.
 * Refuses to delete a role that still has ACTIVE assignments.
 */
export async function deleteRole(actorId, key) {
  const role = await Role.findOne({ key: key.toLowerCase() });
  if (!role) throw new NotFoundError('Role', { key });

  if (!role.isDeletable) {
    throw new AuthorizationError(`Role "${role.key}" is protected and cannot be deleted.`);
  }
  await assertCanManageRoleByDiscordId(actorId, role);

  const activeCount = await RoleAssignment.countDocuments({
    role: role._id,
    active: true,
  });
  if (activeCount > 0) {
    throw new ConflictError(
      `Cannot delete role "${role.key}" — ${activeCount} active assignment(s) exist. Remove them first.`
    );
  }

  const before = role.toObject();
  await role.deleteOne();

  await audit({
    actorId,
    action: 'role.deleted',
    category: 'ROLE',
    targetType: 'Role',
    targetId: before._id,
    before,
  });

  return before;
}

// ---------- Assignment ----------

/**
 * Assign a role to a user by discordId.
 * Enforces:
 *   - actor can manage the role
 *   - actor can manage the target user's current highest role (i.e.
 *     cannot assign a role to someone who outranks them)
 *   - idempotent: re-assigning an active role is a no-op
 */
export async function assignRole(actorId, discordId, roleKey, { reason = null } = {}) {
  const [user, role] = await Promise.all([
    User.findOne({ discordId }),
    Role.findOne({ key: roleKey.toLowerCase(), active: true }),
  ]);
  if (!user) throw new NotFoundError('User', { discordId });
  if (!role) throw new NotFoundError('Role', { key: roleKey });

  await assertCanManageRoleByDiscordId(actorId, role);

  // Actor must also outrank the target's current highest role.
  const { priority: targetPriority, role: targetTop } =
    await getHighestPriority(user._id);
  if (targetTop && targetTop.isPermanent !== true) {
    const { priority: actorPriority, role: actorTop } =
      await getHighestPriorityByDiscordId(actorId);
    if (
      actorTop?.isPermanent !== true &&
      actorPriority <= targetPriority &&
      actorId !== discordId
    ) {
      throw new AuthorizationError(
        'You cannot modify roles for a user at or above your priority level.'
      );
    }
  }

  // Idempotent activation:
  //   1. Try reactivating a previously removed assignment.
  //   2. If none exists, create a new one.
  //   3. Catch unique-index conflicts as no-ops.
  const existingActive = await RoleAssignment.findOne({
    user: user._id,
    role: role._id,
    active: true,
  });
  if (existingActive) {
    logger.debug(
      { discordId, roleKey: role.key },
      'Role already assigned — no-op'
    );
    return { assigned: false, role: role.key, discordId };
  }

  const reactivated = await RoleAssignment.findOneAndUpdate(
    { user: user._id, role: role._id, active: false },
    {
      $set: {
        active: true,
        assignedBy: actorId,
        assignedAt: new Date(),
        removedAt: null,
        removedBy: null,
        reason,
      },
    },
    { new: true }
  );

  if (!reactivated) {
    try {
      await RoleAssignment.create({
        user: user._id,
        discordId: user.discordId,
        role: role._id,
        roleKey: role.key,
        assignedBy: actorId,
        reason,
        active: true,
      });
    } catch (err) {
      if (err.code === 11000) {
        // Concurrent assign raced us; treat as no-op.
        logger.debug({ discordId, roleKey: role.key }, 'Concurrent assign — no-op');
        return { assigned: false, role: role.key, discordId };
      }
      throw err;
    }
  }

  await audit({
    actorId,
    action: 'role.assigned',
    category: 'ROLE',
    targetType: 'User',
    targetId: user._id,
    after: { discordId, roleKey: role.key },
    reason,
  });

  return { assigned: true, role: role.key, discordId };
}

/**
 * Remove a role from a user. Soft-delete (active: false).
 * Idempotent: removing a role that isn't assigned is a no-op.
 */
export async function removeRole(actorId, discordId, roleKey, { reason = null } = {}) {
  const [user, role] = await Promise.all([
    User.findOne({ discordId }),
    Role.findOne({ key: roleKey.toLowerCase() }),
  ]);
  if (!user) throw new NotFoundError('User', { discordId });
  if (!role) throw new NotFoundError('Role', { key: roleKey });

  await assertCanManageRoleByDiscordId(actorId, role);

  const assignment = await RoleAssignment.findOne({
    user: user._id,
    role: role._id,
    active: true,
  });
  if (!assignment) {
    return { removed: false, role: role.key, discordId };
  }

  assignment.active = false;
  assignment.removedAt = new Date();
  assignment.removedBy = actorId;
  assignment.reason = reason ?? assignment.reason;
  await assignment.save();

  await audit({
    actorId,
    action: 'role.removed',
    category: 'ROLE',
    targetType: 'User',
    targetId: user._id,
    before: { discordId, roleKey: role.key },
    reason,
  });

  return { removed: true, role: role.key, discordId };
}

// ---------- Helpers ----------

/**
 * Validate permission strings. Wildcards allowed.
 * Rejects anything that is not a string, is empty, or is too long.
 * Does NOT require the permission to exist in the catalog — an
 * unrecognized permission grants nothing at resolve time (see
 * permission.service.expandPermission), so storing it is harmless.
 */
function validatePermissionsShape(permissions) {
  if (!Array.isArray(permissions)) {
    throw new ValidationError('Permissions must be an array of strings.');
  }
  for (const p of permissions) {
    if (typeof p !== 'string' || p.length === 0 || p.length > 60) {
      throw new ValidationError(
        `Invalid permission entry: ${JSON.stringify(p)}`
      );
    }
    if (!/^(\*|[a-z][a-z0-9_]*(\.[a-z0-9_]+|\.[a-z0-9_*]+)?)$/.test(p)) {
      throw new ValidationError(`Permission has invalid format: ${p}`);
    }
  }
}
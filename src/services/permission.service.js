import * as userRepo from '../db/repositories/user.repository.js';
import * as roleAssignmentRepo from '../db/repositories/roleAssignment.repository.js';
import * as permissionRepo from '../db/repositories/permission.repository.js';
import logger from '../config/logger.js';

/**
 * Permission resolver.
 *
 * Loads active roles for a user, expands wildcards against the
 * canonical permission catalog, and returns the effective set.
 */

// ============================================================
//  Catalog cache — rebuilt lazily and once per process
// ============================================================

let catalogKeys = null;
let catalogLoadPromise = null;

async function getAllPermissionKeys() {
  if (catalogKeys) return catalogKeys;
  if (!catalogLoadPromise) {
    catalogLoadPromise = permissionRepo.getAllKeys().then((keys) => {
      catalogKeys = keys;
      return keys;
    });
  }
  return catalogLoadPromise;
}

/** Test-only: clear the catalog cache. */
export function _resetCatalogCache() {
  catalogKeys = null;
  catalogLoadPromise = null;
}

// ============================================================
//  Wildcard expansion
// ============================================================

async function expandPermission(permissionKey) {
  const catalog = await getAllPermissionKeys();

  if (permissionKey === '*') return catalog.slice();

  if (permissionKey.endsWith('.*')) {
    const prefix = permissionKey.slice(0, -1);
    return catalog.filter((k) => k.startsWith(prefix));
  }

  if (catalog.includes(permissionKey)) return [permissionKey];

  logger.debug({ permissionKey }, 'Unknown permission string in role document');
  return [];
}

// ============================================================
//  Load user's active roles
// ============================================================

async function loadActiveRoles(userId) {
  const assignments = await roleAssignmentRepo.findActiveForUser(userId);
  return assignments
    .filter((a) => a.role_db_key && a.role_db_active !== 0)
    .map((a) => ({
      key: a.role_db_key,
      name: a.role_db_name,
      permissions: a.role_db_permissions ?? [],
      priority: a.role_db_priority,
      quotaCategory: a.role_db_quota_category,
      isPermanent: Boolean(a.role_db_is_permanent),
    }));
}

// ============================================================
//  Public API
// ============================================================

export async function getEffectivePermissions(userId) {
  const roles = await loadActiveRoles(userId);
  const set = new Set();

  for (const role of roles) {
    if (role.isPermanent === true) {
      const catalog = await getAllPermissionKeys();
      for (const k of catalog) set.add(k);
      continue;
    }
    for (const p of role.permissions) {
      const expanded = await expandPermission(p);
      for (const k of expanded) set.add(k);
    }
  }

  return set;
}

export async function getEffectivePermissionsArray(userId) {
  const set = await getEffectivePermissions(userId);
  return Array.from(set).sort();
}

export async function hasPermission(userId, permissionKey) {
  if (!permissionKey || permissionKey.includes('*')) {
    throw new Error('hasPermission() requires a concrete permission key, got: ' + permissionKey);
  }
  const set = await getEffectivePermissions(userId);
  return set.has(permissionKey);
}

export async function hasAnyPermission(userId, permissionKeys) {
  if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) return false;
  const set = await getEffectivePermissions(userId);
  return permissionKeys.some((k) => set.has(k));
}

export async function hasAllPermissions(userId, permissionKeys) {
  if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) return true;
  const set = await getEffectivePermissions(userId);
  return permissionKeys.every((k) => set.has(k));
}

export async function getHighestPriority(userId) {
  const roles = await loadActiveRoles(userId);
  let max = 0;
  let highest = null;
  for (const role of roles) {
    if (role.priority > max) {
      max = role.priority;
      highest = role;
    }
  }
  return { priority: max, role: highest };
}

export async function canManageRole(actorId, targetRole) {
  if (!targetRole) return false;

  const { priority: actorPriority, role: actorHighest } =
    await getHighestPriority(actorId);

  if (actorHighest?.isPermanent === true) return true;
  return actorPriority > targetRole.priority;
}

export async function assertCanManageRole(actorId, targetRole) {
  const ok = await canManageRole(actorId, targetRole);
  if (!ok) {
    const { AuthorizationError } = await import('../utils/errors.js');
    throw new AuthorizationError(
      'You cannot manage a role at or above your own priority level.'
    );
  }
}

export async function getUserRolesSummary(userId) {
  const roles = await loadActiveRoles(userId);
  return roles.map((r) => ({
    key: r.key,
    name: r.name,
    priority: r.priority,
    quotaCategory: r.quotaCategory,
  }));
}

// ============================================================
//  Discord-ID convenience wrappers
// ============================================================

async function resolveUserObjectId(discordId) {
  const user = await userRepo.findByDiscordId(discordId);
  return user?.id ?? null;
}

export async function getHighestPriorityByDiscordId(discordId) {
  const userId = await resolveUserObjectId(discordId);
  if (!userId) return { priority: 0, role: null };
  return getHighestPriority(userId);
}

export async function canManageRoleByDiscordId(actorDiscordId, targetRole) {
  if (!targetRole) return false;
  const { priority: actorPriority, role: actorHighest } =
    await getHighestPriorityByDiscordId(actorDiscordId);
  if (actorHighest?.isPermanent === true) return true;
  return actorPriority > targetRole.priority;
}

export async function assertCanManageRoleByDiscordId(actorDiscordId, targetRole) {
  const ok = await canManageRoleByDiscordId(actorDiscordId, targetRole);
  if (!ok) {
    const { AuthorizationError } = await import('../utils/errors.js');
    throw new AuthorizationError(
      'You cannot manage a role at or above your own priority level.'
    );
  }
}

export async function hasPermissionByDiscordId(discordId, permissionKey) {
  const userId = await resolveUserObjectId(discordId);
  if (!userId) return false;
  return hasPermission(userId, permissionKey);
}

export async function getEffectivePermissionsByDiscordId(discordId) {
  const userId = await resolveUserObjectId(discordId);
  if (!userId) return new Set();
  return getEffectivePermissions(userId);
}
import { Role, RoleAssignment, User } from '../models/index.js';
import { ALL_PERMISSION_KEYS } from '../constants/permissions.js';
import logger from '../config/logger.js';

/**
 * Permission resolver.
 *
 * Terminology:
 *   - "wildcard"  = stored permission string that ends with ".*" or is "*"
 *   - "expansion" = replacing a wildcard with the concrete permissions
 *                   it covers, based on the canonical catalog
 *
 * Rules:
 *   - `super_admin` (role.isPermanent === true) always has EVERY permission,
 *     including future ones. It also implicitly satisfies "can manage X".
 *   - Effective permissions = union of permissions from all ACTIVE role
 *     assignments for the user.
 *   - A role with a wildcard expands to every permission in that category.
 *   - Unknown permission strings on a role are preserved (they may be
 *     future permissions the catalog hasn't caught up with yet) but do
 *     NOT grant anything by themselves.
 *
 * Cache strategy:
 *   No in-memory cache in Phase 3. Every check queries MongoDB. This is
 *   fine for our scale (thousands of members, tens of commands/day) and
 *   keeps correctness trivial. Phase 22 may add a short-TTL LRU keyed on
 *   (userId) with an invalidation hook on RoleAssignment / Role writes.
 *   Not now.
 */

/**
 * Load the user's active role documents.
 * Returns an array of `Role` documents (Mongoose docs).
 */
async function loadActiveRoles(userId) {
  // userId here is a Mongo ObjectId (User._id), not a discordId.
  const assignments = await RoleAssignment.find({ user: userId, active: true })
    .populate('role')
    .lean();

  // Filter out orphaned assignments (role doc missing).
  return assignments
    .map((a) => a.role)
    .filter((r) => r && r.active !== false);
}

/**
 * Expand a single permission string against the canonical catalog.
 * Returns an array of concrete permission keys.
 *
 *  - "*"       -> every permission
 *  - "events.*"-> every permission whose key starts with "events."
 *  - "events.view" -> ["events.view"]
 *  - unknown ("foo.bar") -> [] (no grant)
 */
function expandPermission(permissionKey) {
  if (permissionKey === '*') return ALL_PERMISSION_KEYS.slice();

  if (permissionKey.endsWith('.*')) {
    const prefix = permissionKey.slice(0, -1); // keep the trailing dot
    return ALL_PERMISSION_KEYS.filter((k) => k.startsWith(prefix));
  }

  if (ALL_PERMISSION_KEYS.includes(permissionKey)) return [permissionKey];

  // Unknown permission string — likely a typo or an unimplemented
  // future permission. Do not grant. Log at debug so a stray typo
  // in a role document surfaces eventually.
  logger.debug({ permissionKey }, 'Unknown permission string in role document');
  return [];
}

/**
 * Return the full, deduplicated set of effective permissions for a user.
 * Always returns a Set<string>.
 */
export async function getEffectivePermissions(userId) {
  const roles = await loadActiveRoles(userId);

  const set = new Set();

  for (const role of roles) {
    // super_admin: full access, short-circuit.
    if (role.isPermanent === true) {
      for (const k of ALL_PERMISSION_KEYS) set.add(k);
      continue;
    }
    for (const p of role.permissions ?? []) {
      for (const expanded of expandPermission(p)) set.add(expanded);
    }
  }

  return set;
}

/**
 * Return the effective permissions as a sorted array (for display).
 */
export async function getEffectivePermissionsArray(userId) {
  const set = await getEffectivePermissions(userId);
  return Array.from(set).sort();
}

/**
 * Does the user have this exact permission?
 * `permissionKey` must be a concrete key (no wildcards).
 */
export async function hasPermission(userId, permissionKey) {
  if (!permissionKey || permissionKey.includes('*')) {
    throw new Error(
      `hasPermission() requires a concrete permission key, got: ${permissionKey}`
    );
  }
  const set = await getEffectivePermissions(userId);
  return set.has(permissionKey);
}

/**
 * Does the user have ANY of the listed permissions?
 */
export async function hasAnyPermission(userId, permissionKeys) {
  if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) return false;
  const set = await getEffectivePermissions(userId);
  return permissionKeys.some((k) => set.has(k));
}

/**
 * Does the user have ALL of the listed permissions?
 */
export async function hasAllPermissions(userId, permissionKeys) {
  if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) return true;
  const set = await getEffectivePermissions(userId);
  return permissionKeys.every((k) => set.has(k));
}

/**
 * Return the highest role priority held by a user.
 * Used by role.service to enforce "cannot manage equal-or-higher roles".
 */
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

/**
 * Can the actor manage the target role?
 *
 * Rule (§12):
 *   - super_admin can manage anyone (role.isPermanent === true).
 *   - Otherwise, the actor's highest priority must be STRICTLY GREATER
 *     than the target role's priority. A High Command (80) cannot manage
 *     another High Command (80) or Supreme Command (100). A Supreme
 *     Command (100) can manage High Command (80).
 *
 * This is the one place where priority comparisons live. Every service
 * that touches roles routes through here.
 */
export async function canManageRole(actorId, targetRole) {
  if (!targetRole) return false;

  const { priority: actorPriority, role: actorHighest } =
    await getHighestPriority(actorId);

  // super_admin: can manage anything.
  if (actorHighest?.isPermanent === true) return true;

  // Cannot manage a role whose priority is >= actor's highest.
  return actorPriority > targetRole.priority;
}

/**
 * Assert that the actor can manage the target role.
 * Throws AuthorizationError if not. Services call this before mutating.
 */
export async function assertCanManageRole(actorId, targetRole) {
  const ok = await canManageRole(actorId, targetRole);
  if (!ok) {
    const { AuthorizationError } = await import('../utils/errors.js');
    throw new AuthorizationError(
      'You cannot manage a role at or above your own priority level.'
    );
  }
}

/**
 * Convenience: look up a user's active roles as plain objects for display.
 * Returns [{ key, name, priority, quotaCategory }].
 */
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
// Services (role.service, event.service, etc.) receive Discord IDs
// from Discord interactions. They need resolver functions that
// accept a Discord ID without knowing how to resolve the User.
// These wrappers do the resolution and delegate.

async function resolveUserObjectId(discordId) {
  const user = await User.findOne({ discordId }).select('_id').lean();
  return user?._id ?? null;
}

/**
 * Same as `getHighestPriority`, but accepts a Discord ID.
 * Returns { priority: 0, role: null } for unknown users (fail closed).
 */
export async function getHighestPriorityByDiscordId(discordId) {
  const userId = await resolveUserObjectId(discordId);
  if (!userId) return { priority: 0, role: null };
  return getHighestPriority(userId);
}

/**
 * Same as `canManageRole`, but accepts a Discord ID for the actor.
 */
export async function canManageRoleByDiscordId(actorDiscordId, targetRole) {
  if (!targetRole) return false;
  const { priority: actorPriority, role: actorHighest } =
    await getHighestPriorityByDiscordId(actorDiscordId);
  if (actorHighest?.isPermanent === true) return true;
  return actorPriority > targetRole.priority;
}

/**
 * Same as `assertCanManageRole`, but accepts a Discord ID for the actor.
 */
export async function assertCanManageRoleByDiscordId(actorDiscordId, targetRole) {
  const ok = await canManageRoleByDiscordId(actorDiscordId, targetRole);
  if (!ok) {
    const { AuthorizationError } = await import('../utils/errors.js');
    throw new AuthorizationError(
      'You cannot manage a role at or above your own priority level.'
    );
  }
}

/**
 * Same as `hasPermission`, but accepts a Discord ID.
 */
export async function hasPermissionByDiscordId(discordId, permissionKey) {
  const userId = await resolveUserObjectId(discordId);
  if (!userId) return false; // unknown user has no permissions
  return hasPermission(userId, permissionKey);
}

export async function getEffectivePermissionsByDiscordId(discordId) {
  const userId = await resolveUserObjectId(discordId);
  if (!userId) return new Set();
  return getEffectivePermissions(userId);
}
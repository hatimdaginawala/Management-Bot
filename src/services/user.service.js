import * as userRepo from '../db/repositories/user.repository.js';
import * as roleRepo from '../db/repositories/role.repository.js';
import * as roleAssignmentRepo from '../db/repositories/roleAssignment.repository.js';
import * as rankHistoryRepo from '../db/repositories/rankHistory.repository.js';
import * as strikeRepo from '../db/repositories/strike.repository.js';
import * as leaveRepo from '../db/repositories/leave.repository.js';
import * as noticeRepo from '../db/repositories/notice.repository.js';
import * as attendanceRepo from '../db/repositories/attendance.repository.js';
import { audit } from '../utils/audit.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * User service.
 *
 * Public API is identical to the Mongoose version — services, commands,
 * and jobs call the same functions with the same arguments. Only the
 * internals change.
 */

// ============================================================
//  Reads
// ============================================================

export async function getUserByDiscordId(discordId) {
  return userRepo.findByDiscordId(discordId);
}

export async function requireUserByDiscordId(discordId) {
  const user = await userRepo.findByDiscordId(discordId);
  if (!user) throw new NotFoundError('User', { discordId });
  return user;
}

export async function getUserById(id) {
  return userRepo.findById(id);
}

/**
 * List members with filters + pagination.
 */
export async function listMembers({
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
  // Ensure sane pagination bounds.
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));

  const effectiveStatus = status === undefined ? 'ACTIVE' : status;

  const { items, total } = await userRepo.list({
    status: effectiveStatus,
    roleKey,
    quotaCategory,
    robloxRankId,
    robloxRankName,
    hasStrikes,
    onLeave,
    search,
    page,
    pageSize,
  });

  // Enrich items with role summaries in one batch query.
  const ids = items.map((u) => u.id);
  const roleMap = new Map();
  for (const userId of ids) {
    const assignments = await roleAssignmentRepo.findActiveForUser(userId);
    roleMap.set(userId, assignments
      .filter((a) => a.role_db_key)
      .map((a) => ({
        key: a.role_db_key,
        name: a.role_db_name,
        priority: a.role_db_priority,
      }))
      .sort((a, b) => b.priority - a.priority)
    );
  }

  const enriched = items.map((u) => ({
    ...u,
    roles: roleMap.get(u.id) ?? [],
  }));

  return {
    items: enriched,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Full profile for a single member.
 */
export async function getMemberProfile(discordId) {
  const user = await userRepo.findByDiscordId(discordId);
  if (!user) return null;

  const [assignments, activeStrikes, activeLeave, activeNotices] = await Promise.all([
    roleAssignmentRepo.findActiveForUser(user.id),
    strikeRepo.listActiveForUser(discordId),
    leaveRepo.findActiveForDiscordId(discordId),
    noticeRepo.listActiveForDiscordId(discordId),
  ]);

  const roles = assignments
    .filter((a) => a.role_db_key)
    .map((a) => ({
      key: a.role_db_key,
      name: a.role_db_name,
      priority: a.role_db_priority,
      quotaCategory: a.role_db_quota_category,
    }))
    .sort((a, b) => b.priority - a.priority);

  return {
    user,
    roles,
    activeStrikes: activeStrikes.length,
    strikes: activeStrikes,
    activeLeave,
    activeNotices,
  };
}

/**
 * Combined historical timeline for a user.
 */
export async function getMemberHistory(discordId, { limit = 20 } = {}) {
  const user = await userRepo.findByDiscordId(discordId);
  if (!user) return null;

  const [rankChanges, attendance, strikes] = await Promise.all([
    rankHistoryRepo.listForUser(user.id, { limit }),
    attendanceRepo.historyForDiscordId(discordId, { limit }),
    strikeRepo.historyForUser(discordId, { limit }),
  ]);

  const events = [
    ...rankChanges.map((r) => ({ at: r.changed_at, kind: 'rank_change', data: r })),
    ...attendance.map((a) => ({ at: a.event_at, kind: 'attendance', data: a })),
    ...strikes.map((s) => ({
      at: s.issued_at,
      kind: s.status === 'ACTIVE' ? 'strike_issued' : 'strike_resolved',
      data: s,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return { user, events };
}

// ============================================================
//  Create / status transitions
// ============================================================

/**
 * Idempotent user creation by Discord ID.
 */
export async function ensureUserByDiscordId(discordId, { discordUsername = null } = {}) {
  const existing = await userRepo.findByDiscordId(discordId);
  if (existing) {
    if (discordUsername && existing.discord_username !== discordUsername) {
      const updated = await userRepo.updateByDiscordId(discordId, { discordUsername });
      return { user: updated, created: false };
    }
    return { user: existing, created: false };
  }

  try {
    const user = await userRepo.create({ discordId, discordUsername, status: 'UNVERIFIED' });
    await audit({
      actorId: 'system',
      action: 'user.created',
      category: 'USER',
      targetType: 'User',
      targetId: user.id,
      after: { discordId, status: user.status },
    });
    return { user, created: true };
  } catch (err) {
    if (err instanceof ConflictError) {
      const user = await userRepo.findByDiscordId(discordId);
      return { user, created: false };
    }
    throw err;
  }
}

/**
 * Set the user's status, with guards.
 */
export async function setStatus(actorId, discordId, status, { reason = null } = {}) {
  const valid = ['ACTIVE', 'LEFT_ROBLOX_GROUP', 'UNVERIFIED', 'SUSPENDED', 'INACTIVE'];
  if (!valid.includes(status)) {
    throw new ValidationError('Invalid status: ' + status);
  }
  if (status === 'SUSPENDED' && !reason) {
    throw new ValidationError('Suspension requires a reason.');
  }

  const user = await requireUserByDiscordId(discordId);
  const before = user.status;
  if (before === status) return user;

  const patch = { status };
  if (status === 'SUSPENDED') {
    patch.suspendedAt = new Date();
    patch.suspensionReason = reason;
  } else if (before === 'SUSPENDED') {
    patch.suspendedAt = null;
    patch.suspensionReason = null;
  }
  if (status === 'LEFT_ROBLOX_GROUP') {
    patch.lastLeftRobloxAt = new Date();
  }

  const updated = await userRepo.updateByDiscordId(discordId, patch);

  await audit({
    actorId,
    action: 'user.status.changed',
    category: 'USER',
    targetType: 'User',
    targetId: user.id,
    before: { status: before },
    after: { status },
    reason,
  });

  return updated;
}

/**
 * Application-driven deactivation (distinct from Roblox sync).
 */
export async function deactivateUser(actorId, discordId, { reason } = {}) {
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required to deactivate a user.');
  }
  const user = await requireUserByDiscordId(discordId);
  if (user.status === 'INACTIVE') return user;

  const before = user.status;
  const updated = await userRepo.updateByDiscordId(discordId, {
    status: 'INACTIVE',
    suspensionReason: reason,
  });

  await audit({
    actorId,
    action: 'user.deactivated',
    category: 'USER',
    targetType: 'User',
    targetId: user.id,
    before: { status: before },
    after: { status: 'INACTIVE' },
    reason,
  });
  return updated;
}

export async function reactivateUser(actorId, discordId, { reason = null } = {}) {
  const user = await requireUserByDiscordId(discordId);
  if (user.status !== 'INACTIVE') return user;

  const before = user.status;
  const updated = await userRepo.updateByDiscordId(discordId, {
    status: 'ACTIVE',
    suspensionReason: null,
  });

  await audit({
    actorId,
    action: 'user.reactivated',
    category: 'USER',
    targetType: 'User',
    targetId: user.id,
    before: { status: before },
    after: { status: 'ACTIVE' },
    reason,
  });
  return updated;
}

// ============================================================
//  Quota exemption
// ============================================================

export async function setQuotaExemption(actorId, discordId, {
  reason,
  exemptUntil = null,
} = {}) {
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required to grant an exemption.');
  }
  if (exemptUntil !== null && !(exemptUntil instanceof Date)) {
    throw new ValidationError('exemptUntil must be a Date or null.');
  }
  if (exemptUntil && exemptUntil <= new Date()) {
    throw new ValidationError('exemptUntil must be in the future.');
  }

  const user = await requireUserByDiscordId(discordId);
  const before = {
    exempt: user.quota_exempt,
    exemptUntil: user.quota_exempt_until,
    exemptReason: user.quota_exempt_reason,
  };

  const updated = await userRepo.updateByDiscordId(discordId, {
    quotaExempt: true,
    quotaExemptUntil: exemptUntil,
    quotaExemptReason: reason,
  });

  await audit({
    actorId,
    action: 'quota.exemption_granted',
    category: 'QUOTA',
    targetType: 'User',
    targetId: user.id,
    before,
    after: { exempt: true, exemptUntil, exemptReason: reason },
    reason,
  });
  return updated;
}

export async function clearQuotaExemption(actorId, discordId, { reason = null } = {}) {
  const user = await requireUserByDiscordId(discordId);
  const before = {
    exempt: user.quota_exempt,
    exemptUntil: user.quota_exempt_until,
    exemptReason: user.quota_exempt_reason,
  };

  if (!before.exempt && !before.exemptUntil) return user;

  const updated = await userRepo.updateByDiscordId(discordId, {
    quotaExempt: false,
    quotaExemptUntil: null,
    quotaExemptReason: null,
  });

  await audit({
    actorId,
    action: 'quota.exemption_revoked',
    category: 'QUOTA',
    targetType: 'User',
    targetId: user.id,
    before,
    after: { exempt: false, exemptUntil: null, exemptReason: null },
    reason,
  });
  return updated;
}

// ============================================================
//  Quota category recomputation
// ============================================================

/**
 * Recompute quota category from the user's active roles.
 * Rule D1: STAFF beats LOW_RANK when both are held.
 */
export async function recomputeQuotaCategory(userId) {
  const assignments = await roleAssignmentRepo.findActiveForUser(userId);
  const roles = assignments.filter((a) => a.role_db_key);

  let category = 'NONE';
  if (roles.some((r) => r.role_db_quota_category === 'STAFF')) category = 'STAFF';
  else if (roles.some((r) => r.role_db_quota_category === 'LOW_RANK')) category = 'LOW_RANK';

  const user = await userRepo.findById(userId);
  if (!user) return null;
  if (user.quota_category === category) return user;

  const updated = await userRepo.updateById(userId, { quotaCategory: category });
  return updated;
}

/**
 * Bulk recompute for every user holding a given role.
 */
export async function recomputeQuotaCategoriesForRole(roleId) {
  const assignments = await roleAssignmentRepo.findActiveByRole(roleId);
  let touched = 0;
  for (const a of assignments) {
    await recomputeQuotaCategory(a.user_id);
    touched++;
  }
  logger.info({ roleId, touched }, 'Bulk quotaCategory recompute complete');
  return touched;
}
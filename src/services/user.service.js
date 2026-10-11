import { User, Role, RoleAssignment, RankHistory, Strike, Leave, Notice, Attendance, Event } from '../models/index.js';
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
 * This service is deliberately small at Phase 3. Roblox verification
 * (Phase 4), Roblox sync (Phase 5), and quota logic (Phase 9) will
 * extend it without breaking these methods.
 */

// ---------- Reads ----------

export async function getUserByDiscordId(discordId) {
  return User.findOne({ discordId }).lean();
}

export async function requireUserByDiscordId(discordId) {
  const user = await User.findOne({ discordId });
  if (!user) throw new NotFoundError('User', { discordId });
  return user;
}

export async function getUserById(id) {
  return User.findById(id).lean();
}

/**
 * List users with optional filters. Returns a paginated shape so
 * Phase 19 command handlers can render with buttons directly.
 */
export async function listUsers({
  status,
  quotaCategory,
  robloxRankId,
  hasRoleKey,
  page = 1,
  pageSize = 25,
} = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (quotaCategory) filter['quota.category'] = quotaCategory;
  if (typeof robloxRankId === 'number') filter['roblox.rankId'] = robloxRankId;

  // Filter by role requires a subquery on RoleAssignment.
  if (hasRoleKey) {
    const role = await Role.findOne({ key: hasRoleKey.toLowerCase() }).lean();
    if (!role) return { items: [], total: 0, page, pageSize };
    const assignments = await RoleAssignment.find({
      role: role._id,
      active: true,
    })
      .select('user')
      .lean();
    filter._id = { $in: assignments.map((a) => a.user) };
  }

  const skip = Math.max(0, (page - 1) * pageSize);
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    User.countDocuments(filter),
  ]);

  return { items, total, page, pageSize };
}

// ---------- Create / status transitions ----------

/**
 * Create a placeholder user (used by verification flow and Roblox sync
 * when a Discord or Roblox identity is first observed).
 * Idempotent on discordId.
 */
export async function ensureUserByDiscordId(discordId, { discordUsername = null } = {}) {
  const existing = await User.findOne({ discordId });
  if (existing) {
    if (discordUsername && existing.discordUsername !== discordUsername) {
      existing.discordUsername = discordUsername;
      await existing.save();
    }
    return { user: existing, created: false };
  }
  try {
    const user = await User.create({
      discordId,
      discordUsername,
      status: 'UNVERIFIED',
    });
    await audit({
      actorId: 'system',
      action: 'user.created',
      category: 'USER',
      targetType: 'User',
      targetId: user._id,
      after: { discordId, status: user.status },
    });
    return { user, created: true };
  } catch (err) {
    if (err.code === 11000) {
      // Concurrent creation; re-fetch.
      const user = await User.findOne({ discordId });
      return { user, created: false };
    }
    throw err;
  }
}

/**
 * Set the user's status. Guards against moving a user to
 * LEFT_ROBLOX_GROUP without a reason.
 */
export async function setStatus(actorId, discordId, status, { reason = null } = {}) {
  const valid = ['ACTIVE', 'LEFT_ROBLOX_GROUP', 'UNVERIFIED', 'SUSPENDED', 'INACTIVE'];
  if (!valid.includes(status)) {
    throw new ValidationError(`Invalid status: ${status}`);
  }
  if (status === 'SUSPENDED' && !reason) {
    throw new ValidationError('Suspension requires a reason.');
  }

  const user = await requireUserByDiscordId(discordId);
  const before = user.status;
  if (before === status) return user;

  user.status = status;
  if (status === 'SUSPENDED') {
    user.suspendedAt = new Date();
    user.suspensionReason = reason;
  } else if (before === 'SUSPENDED') {
    user.suspendedAt = null;
    user.suspensionReason = null;
  }
  if (status === 'LEFT_ROBLOX_GROUP') {
    user.lastLeftRobloxAt = new Date();
  }
  await user.save();

  await audit({
    actorId,
    action: 'user.status.changed',
    category: 'USER',
    targetType: 'User',
    targetId: user._id,
    before: { status: before },
    after: { status },
    reason,
  });

  return user;
}

// ---------- Quota category recomputation ----------

/**
 * Recompute `User.quota.category` based on the user's active role
 * assignments. Rule D1: STAFF beats LOW_RANK when both are held.
 *
 * Called by:
 *   - role assignment/removal
 *   - role.quotaCategory edits (bulk recompute of affected users)
 *   - Phase 5 Roblox sync (post-sync safety net)
 */
export async function recomputeQuotaCategory(userId) {
  const assignments = await RoleAssignment.find({ user: userId, active: true })
    .populate('role')
    .lean();

  const roles = assignments.map((a) => a.role).filter(Boolean);

  let category = 'NONE';
  if (roles.some((r) => r.quotaCategory === 'STAFF')) category = 'STAFF';
  else if (roles.some((r) => r.quotaCategory === 'LOW_RANK')) category = 'LOW_RANK';

  const user = await User.findById(userId);
  if (!user) return null;
  if (user.quota?.category === category) return user;

  user.set('quota.category', category);
  await user.save();
  return user;
}

/**
 * Bulk recompute for every user holding a given role.
 * Returns number of users touched.
 */
export async function recomputeQuotaCategoriesForRole(roleId) {
  const assignments = await RoleAssignment.find({
    role: roleId,
    active: true,
  })
    .select('user')
    .lean();

  let touched = 0;
  for (const a of assignments) {
    await recomputeQuotaCategory(a.user);
    touched++;
  }
  logger.info({ roleId, touched }, 'Bulk quotaCategory recompute complete');
  return touched;
}

/**
 * List members with rich filtering for /members list.
 *
 * Filters:
 *   status           - one of USER_STATUS, or 'ANY' for all
 *   roleKey          - single internal role key
 *   quotaCategory    - 'NONE' | 'STAFF' | 'LOW_RANK'
 *   robloxRankId     - numeric rank ID
 *   robloxRankName   - exact rank name
 *   hasStrikes       - boolean (has at least 1 ACTIVE strike)
 *   onLeave          - boolean (has an ACTIVE or APPROVED leave covering now)
 *   search           - substring match on discordUsername or robloxUsername
 *
 * Returns { items, total, page, pageSize, totalPages }.
 * `items` include the user's effective roles summary (no populate chains).
 */
export async function listMembers({
  status = 'ACTIVE',
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
  // Sanitize pagination.
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const skip = (page - 1) * pageSize;

  const filter = {};

  if (status && status !== 'ANY') filter.status = status;
  if (quotaCategory) filter['quota.category'] = quotaCategory;
  if (typeof robloxRankId === 'number') filter['roblox.rankId'] = robloxRankId;
  if (robloxRankName) filter['roblox.rankName'] = robloxRankName;

  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [
      { discordUsername: rx },
      { robloxUsername: rx },
      { 'roblox.username': rx },
      { 'roblox.displayName': rx },
    ];
  }

  // Role filter → subquery on RoleAssignment (active only).
  if (roleKey) {
    const role = await Role.findOne({ key: roleKey.toLowerCase() }).lean();
    if (!role) return emptyPage(page, pageSize);
    const assignments = await RoleAssignment.find({ role: role._id, active: true })
      .select('user')
      .lean();
    filter._id = { $in: assignments.map((a) => a.user) };
  }

  // hasStrikes filter → subquery on Strike.
  if (typeof hasStrikes === 'boolean') {
    const rows = await Strike.find({ status: 'ACTIVE' }).select('user').lean();
    const withStrikes = new Set(rows.map((r) => String(r.user)));
    if (hasStrikes) {
      filter._id = intersectWithIdFilter(filter._id, withStrikes);
    } else {
      // Negation: users NOT in the set.
      // We express this as $nin on the set — MongoDB supports it directly.
      filter._id = mergeIdFilter(filter._id, { $nin: Array.from(withStrikes) });
    }
  }

  // onLeave filter → subquery on Leave.
  if (typeof onLeave === 'boolean') {
    const now = new Date();
    const activeLeaves = await Leave.find({
      status: { $in: ['APPROVED'] },
      startAt: { $lte: now },
      endAt: { $gte: now },
    })
      .select('user')
      .lean();
    const onLeaveSet = new Set(activeLeaves.map((l) => String(l.user)));
    if (onLeave) {
      filter._id = intersectWithIdFilter(filter._id, onLeaveSet);
    } else {
      filter._id = mergeIdFilter(filter._id, { $nin: Array.from(onLeaveSet) });
    }
  }

  const [items, total] = await Promise.all([
    User.find(filter).sort({ 'roblox.rankValue': -1, discordUsername: 1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    User.countDocuments(filter),
  ]);

  // Enrich items with role summaries in one batch query.
  const ids = items.map((u) => u._id);
  const assignments = await RoleAssignment.find({ user: { $in: ids }, active: true })
    .populate('role')
    .lean();
  const rolesByUser = new Map();
  for (const a of assignments) {
    if (!a.role) continue;
    const arr = rolesByUser.get(String(a.user)) ?? [];
    arr.push({ key: a.role.key, name: a.role.name, priority: a.role.priority });
    rolesByUser.set(String(a.user), arr);
  }

  const enriched = items.map((u) => ({
    ...u,
    roles: (rolesByUser.get(String(u._id)) ?? []).sort((a, b) => b.priority - a.priority),
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
 * Used by /members view and /stats user.
 * Returns null if not found.
 */
export async function getMemberProfile(discordId) {
  const user = await User.findOne({ discordId }).lean();
  if (!user) return null;

  const [assignments, strikes, activeLeave, activeNotices] = await Promise.all([
    RoleAssignment.find({ user: user._id, active: true }).populate('role').lean(),
    Strike.find({ user: user._id, status: 'ACTIVE' }).sort({ issuedAt: -1 }).lean(),
    Leave.findOne({
      user: user._id,
      status: 'APPROVED',
      startAt: { $lte: new Date() },
      endAt: { $gte: new Date() },
    }).lean(),
    Notice.find({ user: user._id, status: 'ACTIVE' }).lean(),
  ]);

  const roles = assignments
    .map((a) => a.role)
    .filter(Boolean)
    .map((r) => ({ key: r.key, name: r.name, priority: r.priority, quotaCategory: r.quotaCategory }))
    .sort((a, b) => b.priority - a.priority);

  return {
    user,
    roles,
    activeStrikes: strikes.length,
    strikes,
    activeLeave,
    activeNotices,
  };
}/**
 * Combined historical timeline for a user.
 * Returns up to `limit` entries per category, merged and sorted
 * by timestamp DESC.
 *
 * `limit` applies PER category, not to the merged result.
 */
export async function getMemberHistory(discordId, { limit = 20 } = {}) {
  const user = await User.findOne({ discordId }).lean();
  if (!user) return null;

  const [rankChanges, attendance, strikes] = await Promise.all([
    RankHistory.find({ user: user._id })
      .sort({ changedAt: -1 })
      .limit(limit)
      .lean(),
    Attendance.find({ user: user._id, active: true })
      .sort({ eventAt: -1 })
      .limit(limit)
      .lean(),
    Strike.find({ user: user._id })
      .sort({ issuedAt: -1 })
      .limit(limit)
      .lean(),
  ]);

  const events = [
    ...rankChanges.map((r) => ({
      at: r.changedAt,
      kind: 'rank_change',
      data: r,
    })),
    ...attendance.map((a) => ({
      at: a.eventAt,
      kind: 'attendance',
      data: a,
    })),
    ...strikes.map((s) => ({
      at: s.issuedAt,
      kind: s.status === 'ACTIVE' ? 'strike_issued' : 'strike_resolved',
      data: s,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return { user, events };
}
/**
 * Application-driven deactivation.
 * Distinct from Roblox sync — this is an administrative override.
 */
export async function deactivateUser(actorId, discordId, { reason } = {}) {
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required to deactivate a user.');
  }
  const user = await requireUserByDiscordId(discordId);
  if (user.status === 'INACTIVE') return user;

  const before = user.status;
  user.status = 'INACTIVE';
  user.suspensionReason = reason;
  await user.save();

  await audit({
    actorId,
    action: 'user.deactivated',
    category: 'USER',
    targetType: 'User',
    targetId: user._id,
    before: { status: before },
    after: { status: 'INACTIVE' },
    reason,
  });
  return user;
}

export async function reactivateUser(actorId, discordId, { reason = null } = {}) {
  const user = await requireUserByDiscordId(discordId);
  if (user.status !== 'INACTIVE') return user;

  const before = user.status;
  user.status = 'ACTIVE';
  user.suspensionReason = null;
  await user.save();

  await audit({
    actorId,
    action: 'user.reactivated',
    category: 'USER',
    targetType: 'User',
    targetId: user._id,
    before: { status: before },
    after: { status: 'ACTIVE' },
    reason,
  });
  return user;
}
/**
 * Grant a quota exemption to a user.
 * If the user is already exempt, updates the fields.
 * `exemptUntil = null` means permanent until explicitly revoked.
 */
export async function setQuotaExemption(
  actorId,
  discordId,
  { reason, exemptUntil = null } = {}
) {
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
    exempt: user.quota?.exempt ?? false,
    exemptUntil: user.quota?.exemptUntil ?? null,
    exemptReason: user.quota?.exemptReason ?? null,
  };

  user.set('quota.exempt', true);
  user.set('quota.exemptUntil', exemptUntil);
  user.set('quota.exemptReason', reason);
  await user.save();

  await audit({
    actorId,
    action: 'quota.exemption_granted',
    category: 'QUOTA',
    targetType: 'User',
    targetId: user._id,
    before,
    after: { exempt: true, exemptUntil, exemptReason: reason },
    reason,
  });
  return user;
}

/**
 * Revoke a quota exemption.
 * Idempotent: revoking a non-exempt user is a no-op.
 */
export async function clearQuotaExemption(actorId, discordId, { reason = null } = {}) {
  const user = await requireUserByDiscordId(discordId);
  const before = {
    exempt: user.quota?.exempt ?? false,
    exemptUntil: user.quota?.exemptUntil ?? null,
    exemptReason: user.quota?.exemptReason ?? null,
  };

  if (!before.exempt && !before.exemptUntil) return user;

  user.set('quota.exempt', false);
  user.set('quota.exemptUntil', null);
  user.set('quota.exemptReason', null);
  await user.save();

  await audit({
    actorId,
    action: 'quota.exemption_revoked',
    category: 'QUOTA',
    targetType: 'User',
    targetId: user._id,
    before,
    after: { exempt: false, exemptUntil: null, exemptReason: null },
    reason,
  });
  return user;
}

// ---------- Internal helpers ----------

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function emptyPage(page, pageSize) {
  return { items: [], total: 0, page, pageSize, totalPages: 1 };
}

/**
 * Intersect an existing `_id` filter (or null) with a set of IDs.
 * Handles the various shapes: undefined, {$in: [...]}, {$nin: [...]}.
 */
function intersectWithIdFilter(existingIdFilter, idSet) {
  const asStrings = Array.from(idSet);
  if (!existingIdFilter) return { $in: asStrings };
  if (existingIdFilter.$in) {
    const set = new Set(existingIdFilter.$in.map(String));
    const intersection = asStrings.filter((id) => set.has(String(id)));
    return { $in: intersection };
  }
  // If existing has $nin, intersecting with an $in is expressed as
  // $in over the smaller set minus the nin set.
  if (existingIdFilter.$nin) {
    const ninSet = new Set(existingIdFilter.$nin.map(String));
    return { $in: asStrings.filter((id) => !ninSet.has(String(id))) };
  }
  return { $in: asStrings };
}

function mergeIdFilter(existingIdFilter, additional) {
  if (!existingIdFilter) return additional;
  // If both are $nin, merge into a combined $nin.
  if (existingIdFilter.$nin && additional.$nin) {
    const combined = new Set([
      ...existingIdFilter.$nin.map(String),
      ...additional.$nin.map(String),
    ]);
    return { $nin: Array.from(combined) };
  }
  // If existing is $in and additional is $nin, subtract.
  if (existingIdFilter.$in && additional.$nin) {
    const ninSet = new Set(additional.$nin.map(String));
    return { $in: existingIdFilter.$in.filter((id) => !ninSet.has(String(id))) };
  }
  // Fallback: intersect via $and on _id (rare path).
  return { $in: existingIdFilter.$in ?? [] };
}
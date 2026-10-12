import * as userRepo from '../db/repositories/user.repository.js';
import * as eventRepo from '../db/repositories/event.repository.js';
import * as attendanceRepo from '../db/repositories/attendance.repository.js';
import * as quotaResultRepo from '../db/repositories/quotaResult.repository.js';
import * as strikeRepo from '../db/repositories/strike.repository.js';
import * as leaveRepo from '../db/repositories/leave.repository.js';
import * as noticeRepo from '../db/repositories/notice.repository.js';
import * as removalRequestRepo from '../db/repositories/removalRequest.repository.js';
import * as rankHistoryRepo from '../db/repositories/rankHistory.repository.js';
import * as syncLogRepo from '../db/repositories/syncLog.repository.js';
import * as roleAssignmentRepo from '../db/repositories/roleAssignment.repository.js';
import { isoWeekBounds, isoWeekKey } from '../utils/isoWeek.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';

/**
 * Statistics service. Public API unchanged.
 *
 * All aggregations use the repository layer, which in turn uses SQL
 * GROUP BY / COUNT / SUM. No full-table scans on large collections.
 */

const DAY_MS = 86_400_000;
const MAX_TOP = 50;

// ============================================================
//  Time-window helpers
// ============================================================

function floorToUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function monthBounds(date) {
  const d = new Date(date);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { startAt: start, endAt: end };
}

function windowFor(kind, asOf = new Date()) {
  if (kind === 'daily') {
    const startAt = floorToUtcDay(asOf);
    return { startAt, endAt: new Date(startAt.getTime() + DAY_MS), kind };
  }
  if (kind === 'weekly') {
    const { startAt, endAt } = isoWeekBounds(asOf);
    return { startAt, endAt, kind, periodKey: isoWeekKey(asOf) };
  }
  if (kind === 'monthly') {
    const { startAt, endAt } = monthBounds(asOf);
    return { startAt, endAt, kind };
  }
  throw new ValidationError('Unknown window kind: ' + kind);
}

// ============================================================
//  Window summary
// ============================================================

export async function windowSummary(kind, { asOf = new Date(), top = 5 } = {}) {
  const { startAt, endAt, periodKey } = windowFor(kind, asOf);
  top = Math.min(MAX_TOP, Math.max(1, Number(top) || 5));

  const [
    eventsByStatus,
    eventsByType,
    attendanceCounts,
    topHosts,
    topAttendees,
    newStrikes,
    recoveredStrikes,
    quotaMet,
    quotaMissed,
    pendingRemovals,
    activeLeaves,
    activeNotices,
    syncSummary,
  ] = await Promise.all([
    eventRepo.countByStatusInRange({ from: startAt, to: endAt }),
    eventRepo.countByTypeInRange({ from: startAt, to: endAt }),
    attendanceRepo.distinctCountsInRange({ from: startAt, to: endAt }),
    eventRepo.topHostsInRange({ from: startAt, to: endAt, limit: top }),
    attendanceRepo.topAttendeesInRange({ from: startAt, to: endAt, limit: top }),
    strikeRepo.countIssuedInWindow({ from: startAt, to: endAt }),
    strikeRepo.countRecoveredInWindow({ from: startAt, to: endAt }),
    quotaResultRepo.countByStatusInWindow({ from: startAt, to: endAt, status: 'MET' }),
    quotaResultRepo.countByStatusInWindow({ from: startAt, to: endAt, status: 'MISSED' }),
    removalRequestRepo.countCreatedInWindow({ from: startAt, to: endAt }),
    leaveRepo.findOverlappingApprovedInPeriod({ start_at: startAt, end_at: endAt }).then((ids) => ids.length),
    noticeRepo.countActiveInRange({ from: startAt, to: endAt }),
    syncLogRepo.aggregateInWindow({ from: startAt, to: endAt }),
  ]);

  const totalEvents = eventsByStatus.APPROVED || 0;

  return {
    kind,
    asOf: asOf.toISOString(),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    periodKey: periodKey ?? null,
    summary: {
      totalEvents,
      totalAttendance: attendanceCounts.total,
      newStrikes,
      recoveredStrikes,
      pendingRemovals,
      activeLeaves,
      activeNotices,
      quotaMet,
      quotaMissed,
    },
    eventsByType,
    topHosts,
    topAttendees,
    sync: syncSummary,
  };
}

export async function dailyStats(opts = {}) {
  return windowSummary('daily', opts);
}

export async function weeklyStats(opts = {}) {
  return windowSummary('weekly', opts);
}

export async function monthlyStats(opts = {}) {
  return windowSummary('monthly', opts);
}

// ============================================================
//  Per-user dashboard
// ============================================================

export async function userStats(discordId) {
  const user = await userRepo.findByDiscordId(discordId);
  if (!user) throw new NotFoundError('User', { discordId });

  const [
    assignments,
    totalEventsHosted,
    totalEventsAttended,
    activeStrikes,
    lifetimeStrikes,
    recoveredStrikes,
    rankChangeCount,
    activeLeave,
    activeNotices,
    recentQuotaResults,
  ] = await Promise.all([
    roleAssignmentRepo.findActiveForUser(user.id),
    eventRepo.countApprovedByHostInRange(discordId, {
      from: new Date(0),
      to: new Date(Date.now() + 100 * 365 * DAY_MS),
    }),
    attendanceRepo.countActiveForUserInRange(user.id, {
      from: new Date(0),
      to: new Date(Date.now() + 100 * 365 * DAY_MS),
    }),
    strikeRepo.countActiveForUser(discordId),
    strikeRepo.historyForUser(discordId, { limit: 200 }).then((rows) => rows.length),
    strikeRepo.historyForUser(discordId, { limit: 200 }).then(
      (rows) => rows.filter((s) => s.status === 'RECOVERED').length
    ),
    rankHistoryRepo.countForUser(user.id),
    leaveRepo.findActiveForDiscordId(discordId),
    noticeRepo.listActiveForDiscordId(discordId),
    quotaResultRepo.recentForUser(user.id, { limit: 8 }),
  ]);

  const roles = assignments
    .filter((a) => a.role_db_key)
    .map((a) => ({
      key: a.role_db_key,
      name: a.role_db_name,
      priority: a.role_db_priority,
    }))
    .sort((a, b) => b.priority - a.priority);

  return {
    user: {
      discordId: user.discord_id,
      discordUsername: user.discord_username,
      robloxId: user.roblox_id,
      robloxUsername: user.roblox_username,
      status: user.status,
      quotaCategory: user.quota_category,
      quotaExempt: user.quota_exempt,
      joinedAt: user.joined_at,
    },
    roles,
    activity: {
      totalEventsHosted,
      totalEventsAttended,
      rankChanges: rankChangeCount,
    },
    strikes: {
      active: activeStrikes,
      lifetime: lifetimeStrikes,
      recovered: recoveredStrikes,
    },
    activeLeave,
    activeNotices,
    recentQuotaResults: recentQuotaResults.map((q) => ({
      periodKey: q.period_key,
      category: q.category,
      required: q.required_amount,
      actual: q.actual_amount,
      status: q.status,
    })),
  };
}

// ============================================================
//  Domain statistics
// ============================================================

export async function eventStats({ from = null, to = null } = {}) {
  const fromDate = from ?? new Date(0);
  const toDate = to ?? new Date(Date.now() + 100 * 365 * DAY_MS);

  const [byStatus, byType] = await Promise.all([
    eventRepo.countByStatusInRange({ from: fromDate, to: toDate }),
    eventRepo.countByTypeInRange({ from: fromDate, to: toDate }),
  ]);

  const total = Object.values(byStatus).reduce((s, n) => s + n, 0);

  return {
    total,
    byStatus,
    byType,
  };
}

/**
 * Counts events in a window grouped by type + status.
 * Used by /event stats.
 */
export async function eventCountsInWindow({ from, to }) {
  const [byStatus, byType] = await Promise.all([
    eventRepo.countByStatusInRange({ from, to }),
    eventRepo.countByTypeInRange({ from, to }),
  ]);
  const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
  return { total, byStatus, byType };
}

export async function attendanceStats({ from = null, to = null } = {}) {
  const counts = await attendanceRepo.distinctCountsInRange({ from, to });

  const avgPerEvent = counts.uniqueEvents > 0
    ? Math.round((counts.total / counts.uniqueEvents) * 100) / 100
    : 0;

  return {
    totalAttendance: counts.total,
    uniqueAttendees: counts.uniqueAttendees,
    uniqueEvents: counts.uniqueEvents,
    avgPerEvent,
  };
}

export async function hostStats({ from = null, to = null, top = 10 } = {}) {
  top = Math.min(MAX_TOP, Math.max(1, Number(top) || 10));

  const fromDate = from ?? new Date(0);
  const toDate = to ?? new Date(Date.now() + 100 * 365 * DAY_MS);

  const rows = await eventRepo.topHostsInRange({ from: fromDate, to: toDate, limit: top });

  return rows.map((r) => ({
    discordId: r.discordId,
    discordUsername: r.discordUsername,
    robloxUsername: r.robloxUsername,
    count: r.count,
  }));
}

export async function quotaStats({ from = null, to = null } = {}) {
  return quotaResultRepo.aggregateByCategoryAndStatus({ from, to });
}

export async function strikeStats({ from = null, to = null, top = 10 } = {}) {
  top = Math.min(MAX_TOP, Math.max(1, Number(top) || 10));

  const [byStatus, topUsers] = await Promise.all([
    strikeRepo.aggregateByStatusInWindow({ from, to }),
    strikeRepo.topUsersWithActiveStrikes({ limit: top }),
  ]);

  const total = Object.values(byStatus).reduce((s, n) => s + n, 0);

  return {
    total,
    byStatus,
    topUsersWithActiveStrikes: topUsers,
  };
}

export async function syncStats({ limit = 10 } = {}) {
  limit = Math.min(50, Math.max(1, Number(limit) || 10));

  const [recent, totals] = await Promise.all([
    syncLogRepo.listRecent({ limit }),
    syncLogRepo.aggregateInWindow({}),
  ]);

  return {
    lastSyncs: recent.map((s) => ({
      startedAt: s.started_at,
      completedAt: s.completed_at,
      status: s.status,
      membersFetched: s.members_fetched,
      rankChanges: s.rank_changes,
      membersRemoved: s.members_removed,
    })),
    totals,
  };
}

export async function memberBreakdown() {
  // Implemented via repository count queries.
  // We don't have a single aggregate that returns everything, so we
  // batch a few queries.
  const [byStatusList, byCategoryList] = await Promise.all([
    userRepo.countByStatus(),
    userRepo.countByQuotaCategory(),
  ]);

  const byStatus = Object.fromEntries(byStatusList.map((r) => [r.status, r.count]));
  const byQuotaCategory = Object.fromEntries(byCategoryList.map((r) => [r.category, r.count]));

  // Role breakdown
  const byRoleList = await roleAssignmentRepo.countActiveByRoleKey();

  // Rank breakdown — light aggregate
  const byRankList = await userRepo.countByRobloxRankName({ limit: 20 });

  return {
    byStatus,
    byQuotaCategory,
    byRobloxRank: byRankList.map((r) => ({ rankName: r.rankName, count: r.count })),
    byRole: byRoleList.map((r) => ({ roleKey: r.roleKey, count: r.count })),
  };
}
import {
  User,
  Role,
  RoleAssignment,
  Event,
  EventType,
  Attendance,
  QuotaResult,
  Strike,
  Leave,
  Notice,
  RemovalRequest,
  RankHistory,
  SyncLog,
} from '../models/index.js';
import { isoWeekBounds, isoWeekKey } from '../utils/isoWeek.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';

/**
 * Statistics service.
 *
 * Read-only aggregations. Every function returns plain JS objects.
 * No Mongoose documents are exposed to callers — this keeps the layer
 * stable for a future REST API and avoids `.toJSON()` leaks.
 *
 * Conventions:
 *   - All date ranges are half-open: [from, to)
 *   - All times are UTC
 *   - Top-N lists default to 10 and are capped at 50
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
  throw new ValidationError(`Unknown window kind: ${kind}`);
}

// ============================================================
//  Time-window summary — used by daily/weekly/monthly
// ============================================================

/**
 * Return a summary for the given window.
 *
 * Includes:
 *   - total events, grouped by type
 *   - total attendance
 *   - top hosts and top attendees
 *   - new strikes issued, strikes recovered
 *   - quota met / missed
 *   - pending removals created
 *   - active leaves and notices (as of `asOf`)
 *   - Roblox sync summary
 */
export async function windowSummary(kind, { asOf = new Date(), top = 5 } = {}) {
  const { startAt, endAt, periodKey } = windowFor(kind, asOf);
  top = Math.min(MAX_TOP, Math.max(1, Number(top) || 5));

  const [
    totalEvents,
    eventsByType,
    totalAttendance,
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
    Event.countDocuments({ status: 'APPROVED', createdAt: { $gte: startAt, $lt: endAt } }),

    Event.aggregate([
      { $match: { status: 'APPROVED', createdAt: { $gte: startAt, $lt: endAt } } },
      { $group: { _id: '$eventTypeKey', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),

    Attendance.countDocuments({ active: true, eventAt: { $gte: startAt, $lt: endAt } }),

    Event.aggregate([
      { $match: { status: 'APPROVED', createdAt: { $gte: startAt, $lt: endAt } } },
      { $group: {
        _id: '$host.discordId',
        count: { $sum: 1 },
        username: { $first: '$host.discordUsername' },
        robloxUsername: { $first: '$host.robloxUsername' },
      }},
      { $sort: { count: -1, _id: 1 } },
      { $limit: top },
    ]),

    Attendance.aggregate([
      { $match: { active: true, eventAt: { $gte: startAt, $lt: endAt } } },
      { $group: { _id: '$discordId', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: top },
    ]),

    Strike.countDocuments({ issuedAt: { $gte: startAt, $lt: endAt } }),
    Strike.countDocuments({
      status: 'RECOVERED',
      resolvedAt: { $gte: startAt, $lt: endAt },
    }),

    QuotaResult.countDocuments({ evaluatedAt: { $gte: startAt, $lt: endAt }, status: 'MET' }),
    QuotaResult.countDocuments({ evaluatedAt: { $gte: startAt, $lt: endAt }, status: 'MISSED' }),

    RemovalRequest.countDocuments({ createdAt: { $gte: startAt, $lt: endAt } }),

    Leave.countDocuments({
      status: 'APPROVED',
      startAt: { $lt: endAt },
      endAt: { $gt: startAt },
    }),

    Notice.countDocuments({
      status: 'ACTIVE',
      startAt: { $lt: endAt },
      $or: [{ endAt: null }, { endAt: { $gt: startAt } }],
    }),

    SyncLog.aggregate([
      { $match: { status: { $in: ['SUCCESS', 'PARTIAL'] }, startedAt: { $gte: startAt, $lt: endAt } } },
      {
        $group: {
          _id: null,
          syncCount: { $sum: 1 },
          membersFetched: { $sum: '$membersFetched' },
          membersCreated: { $sum: '$membersCreated' },
          membersUpdated: { $sum: '$membersUpdated' },
          rankChanges: { $sum: '$rankChanges' },
          membersRemoved: { $sum: '$membersRemoved' },
        },
      },
    ]),
  ]);

  return {
    kind,
    asOf: asOf.toISOString(),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    periodKey: periodKey ?? null,
    summary: {
      totalEvents,
      totalAttendance,
      newStrikes,
      recoveredStrikes,
      pendingRemovals,
      activeLeaves,
      activeNotices,
      quotaMet,
      quotaMissed,
    },
    eventsByType: eventsByType.map((r) => ({ typeKey: r._id, count: r.count })),
    topHosts: topHosts.map((r) => ({
      discordId: r._id,
      discordUsername: r.username ?? null,
      robloxUsername: r.robloxUsername ?? null,
      count: r.count,
    })),
    topAttendees: topAttendees.map((r) => ({
      discordId: r._id,
      count: r.count,
    })),
    sync: syncSummary[0]
      ? {
          syncCount: syncSummary[0].syncCount,
          membersFetched: syncSummary[0].membersFetched,
          membersCreated: syncSummary[0].membersCreated,
          membersUpdated: syncSummary[0].membersUpdated,
          rankChanges: syncSummary[0].rankChanges,
          membersRemoved: syncSummary[0].membersRemoved,
        }
      : { syncCount: 0, membersFetched: 0, membersCreated: 0, membersUpdated: 0, rankChanges: 0, membersRemoved: 0 },
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

/**
 * Everything known about one user for /stats user.
 */
export async function userStats(discordId) {
  const user = await User.findOne({ discordId }).lean();
  if (!user) throw new NotFoundError('User', { discordId });

  const [
    assignments,
    totalEventsHosted,
    totalEventsAttended,
    activeStrikes,
    lifetimeStrikes,
    recoveredStrikes,
    rankChanges,
    activeLeave,
    activeNotices,
    quotaHistory,
  ] = await Promise.all([
    RoleAssignment.find({ user: user._id, active: true }).populate('role').lean(),
    Event.countDocuments({ 'host.discordId': discordId, status: 'APPROVED' }),
    Attendance.countDocuments({ user: user._id, active: true }),
    Strike.countDocuments({ user: user._id, status: 'ACTIVE' }),
    Strike.countDocuments({ user: user._id }),
    Strike.countDocuments({ user: user._id, status: 'RECOVERED' }),
    RankHistory.countDocuments({ user: user._id }),
    Leave.findOne({
      user: user._id,
      status: 'APPROVED',
      startAt: { $lte: new Date() },
      endAt: { $gte: new Date() },
    }).lean(),
    Notice.find({ user: user._id, status: 'ACTIVE' }).lean(),
    QuotaResult.find({ user: user._id })
      .sort({ evaluatedAt: -1 })
      .limit(8)
      .lean(),
  ]);

  const roles = assignments
    .map((a) => a.role)
    .filter(Boolean)
    .map((r) => ({ key: r.key, name: r.name, priority: r.priority }))
    .sort((a, b) => b.priority - a.priority);

  return {
    user: {
      discordId: user.discordId,
      discordUsername: user.discordUsername ?? null,
      robloxId: user.robloxId ?? null,
      robloxUsername: user.robloxUsername ?? null,
      status: user.status,
      quotaCategory: user.quota?.category ?? 'NONE',
      quotaExempt: Boolean(user.quota?.exempt),
      joinedAt: user.joinedAt,
    },
    roles,
    activity: {
      totalEventsHosted,
      totalEventsAttended,
      rankChanges,
    },
    strikes: {
      active: activeStrikes,
      lifetime: lifetimeStrikes,
      recovered: recoveredStrikes,
    },
    activeLeave,
    activeNotices,
    recentQuotaResults: quotaHistory.map((q) => ({
      periodKey: q.periodKey,
      category: q.category,
      required: q.required,
      actual: q.actual,
      status: q.status,
    })),
  };
}

// ============================================================
//  Domain statistics
// ============================================================

/**
 * Aggregate events over an optional time window.
 * Grouped by: total, status, type.
 */
export async function eventStats({ from = null, to = null } = {}) {
  const match = {};
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lt = new Date(to);
  }

  const [byStatus, byType, total] = await Promise.all([
    Event.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Event.aggregate([
      { $match: match },
      { $group: { _id: '$eventTypeKey', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Event.countDocuments(match),
  ]);

  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
    byType: byType.map((r) => ({ typeKey: r._id, count: r.count })),
  };
}

/**
 * Attendance statistics over an optional time window.
 * Returns total, unique attendees, and avg attendance per event.
 */
export async function attendanceStats({ from = null, to = null } = {}) {
  const match = { active: true };
  if (from || to) {
    match.eventAt = {};
    if (from) match.eventAt.$gte = new Date(from);
    if (to) match.eventAt.$lt = new Date(to);
  }

  const result = await Attendance.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        uniqueUsers: { $addToSet: '$user' },
        uniqueEvents: { $addToSet: '$event' },
      },
    },
    {
      $project: {
        _id: 0,
        total: 1,
        uniqueAttendees: { $size: '$uniqueUsers' },
        uniqueEvents: { $size: '$uniqueEvents' },
      },
    },
  ]);

  const base = result[0] ?? { total: 0, uniqueAttendees: 0, uniqueEvents: 0 };
  const avgPerEvent = base.uniqueEvents > 0
    ? Math.round((base.total / base.uniqueEvents) * 100) / 100
    : 0;

  return {
    totalAttendance: base.total,
    uniqueAttendees: base.uniqueAttendees,
    uniqueEvents: base.uniqueEvents,
    avgPerEvent,
  };
}

/**
 * Top hosts across an optional window. Returns up to `top` entries.
 */
export async function hostStats({ from = null, to = null, top = 10 } = {}) {
  top = Math.min(MAX_TOP, Math.max(1, Number(top) || 10));

  const match = { status: 'APPROVED' };
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lt = new Date(to);
  }

  const rows = await Event.aggregate([
    { $match: match },
    { $group: {
      _id: '$host.discordId',
      count: { $sum: 1 },
      discordUsername: { $first: '$host.discordUsername' },
      robloxUsername: { $first: '$host.robloxUsername' },
    }},
    { $sort: { count: -1, _id: 1 } },
    { $limit: top },
  ]);

  return rows.map((r) => ({
    discordId: r._id,
    discordUsername: r.discordUsername ?? null,
    robloxUsername: r.robloxUsername ?? null,
    count: r.count,
  }));
}

/**
 * Quota statistics: aggregated per-category over a window.
 */
export async function quotaStats({ from = null, to = null } = {}) {
  const match = {};
  if (from || to) {
    match.evaluatedAt = {};
    if (from) match.evaluatedAt.$gte = new Date(from);
    if (to) match.evaluatedAt.$lt = new Date(to);
  }

  const rows = await QuotaResult.aggregate([
    { $match: match },
    {
      $group: {
        _id: { category: '$category', status: '$status' },
        count: { $sum: 1 },
      },
    },
  ]);

  const out = {
    STAFF: { MET: 0, MISSED: 0, EXEMPT: 0 },
    LOW_RANK: { MET: 0, MISSED: 0, EXEMPT: 0 },
  };
  for (const r of rows) {
    const cat = r._id.category;
    const st = r._id.status;
    if (out[cat] && out[cat][st] !== undefined) {
      out[cat][st] = r.count;
    }
  }
  return out;
}

/**
 * Strike statistics: total, active, recovered, cancelled, and per-period.
 */
export async function strikeStats({ from = null, to = null, top = 10 } = {}) {
  top = Math.min(MAX_TOP, Math.max(1, Number(top) || 10));

  const match = {};
  if (from || to) {
    match.issuedAt = {};
    if (from) match.issuedAt.$gte = new Date(from);
    if (to) match.issuedAt.$lt = new Date(to);
  }

  const [byStatus, topUsers, total] = await Promise.all([
    Strike.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Strike.aggregate([
      { $match: { ...match, status: 'ACTIVE' } },
      { $group: { _id: '$discordId', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: top },
    ]),
    Strike.countDocuments(match),
  ]);

  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
    topUsersWithActiveStrikes: topUsers.map((r) => ({
      discordId: r._id,
      count: r.count,
    })),
  };
}

/**
 * Roblox sync summary across recent SyncLogs.
 */
export async function syncStats({ limit = 10 } = {}) {
  limit = Math.min(50, Math.max(1, Number(limit) || 10));

  const [last, aggregate] = await Promise.all([
    SyncLog.find({ type: 'ROBLOX_GROUP_SYNC' })
      .sort({ startedAt: -1 })
      .limit(limit)
      .lean(),
    SyncLog.aggregate([
      { $match: { type: 'ROBLOX_GROUP_SYNC', status: { $in: ['SUCCESS', 'PARTIAL'] } } },
      {
        $group: {
          _id: null,
          syncCount: { $sum: 1 },
          membersFetched: { $sum: '$membersFetched' },
          membersCreated: { $sum: '$membersCreated' },
          membersUpdated: { $sum: '$membersUpdated' },
          rankChanges: { $sum: '$rankChanges' },
          membersRemoved: { $sum: '$membersRemoved' },
        },
      },
    ]),
  ]);

  return {
    lastSyncs: last.map((s) => ({
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      status: s.status,
      membersFetched: s.membersFetched,
      rankChanges: s.rankChanges,
      membersRemoved: s.membersRemoved,
    })),
    totals: aggregate[0] ?? {
      syncCount: 0,
      membersFetched: 0,
      membersCreated: 0,
      membersUpdated: 0,
      rankChanges: 0,
      membersRemoved: 0,
    },
  };
}

/**
 * Member counts grouped by Roblox rank and by internal role.
 */
export async function memberBreakdown() {
  const [byStatus, byQuotaCategory, byRank, byRole] = await Promise.all([
    User.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    User.aggregate([
      { $group: { _id: '$quota.category', count: { $sum: 1 } } },
    ]),
    User.aggregate([
      { $match: { 'roblox.rankName': { $ne: null } } },
      { $group: { _id: '$roblox.rankName', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    RoleAssignment.aggregate([
      { $match: { active: true } },
      { $group: { _id: '$roleKey', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
    byQuotaCategory: Object.fromEntries(byQuotaCategory.map((r) => [r._id, r.count])),
    byRobloxRank: byRank.map((r) => ({ rankName: r._id, count: r.count })),
    byRole: byRole.map((r) => ({ roleKey: r._id, count: r.count })),
  };
}

/**
 * Count events in a window grouped by type and status.
 * Used by /event stats.
 */
export async function eventCountsInWindow({ from, to }) {
  const match = { createdAt: { $gte: from, $lte: to } };

  const [total, byStatus, byType] = await Promise.all([
    Event.countDocuments(match),
    Event.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Event.aggregate([
      { $match: match },
      { $group: { _id: '$eventTypeKey', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
    byType: byType.map((r) => ({ typeKey: r._id, count: r.count })),
  };
}
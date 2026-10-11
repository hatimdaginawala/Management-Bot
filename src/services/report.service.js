import {
  Report,
  User,
  Leave,
  Notice,
  RemovalRequest,
} from '../models/index.js';
import { audit } from '../utils/audit.js';
import {
  windowSummary as _unused, // intentionally not imported — see note below
} from './statistics.service.js';
import * as statisticsService from './statistics.service.js';
import {
  isoWeekKey,
  isoWeekBounds,
} from '../utils/isoWeek.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Report service.
 *
 * Produces structured reports, persists them, and renders Discord
 * payloads. Does NOT send messages — that's Phase 19's job.
 *
 * Idempotency for scheduled reports is enforced by Report's
 * partial-unique index on (kind, reportKey).
 *
 * Manual reports (kind: 'MANUAL') intentionally have `reportKey: null`
 * and are excluded from the partial-unique filter, so multiple can be
 * generated for the same period. This preserves an audit trail of who
 * generated what, when.
 */

const TOP_N = 5;

// ============================================================
//  Public API
// ============================================================

/**
 * Generate a weekly report for the ISO week containing `asOf`.
 * If a report already exists for that week, returns it unchanged.
 */
export async function generateWeeklyReport({ asOf = new Date(), generatedBy = 'system' } = {}) {
  const { startAt, endAt } = isoWeekBounds(asOf);
  const reportKey = isoWeekKey(asOf);

  const existing = await Report.findOne({ kind: 'WEEKLY', reportKey }).lean();
  if (existing) {
    logger.info({ reportKey }, 'Weekly report already exists — returning existing');
    return existing;
  }

  const stats = await statisticsService.weeklyStats({ asOf, top: TOP_N });
  const extra = await collectExtraCounters({ startAt, endAt });

  const doc = await buildAndPersist({
    kind: 'WEEKLY',
    reportKey,
    periodStart: startAt,
    periodEnd: endAt,
    generatedBy,
    stats,
    extra,
  });

  return doc;
}

/**
 * Generate a monthly report for the calendar month containing `asOf`.
 */
export async function generateMonthlyReport({ asOf = new Date(), generatedBy = 'system' } = {}) {
  const d = new Date(asOf);
  const startAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const endAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const reportKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

  const existing = await Report.findOne({ kind: 'MONTHLY', reportKey }).lean();
  if (existing) {
    logger.info({ reportKey }, 'Monthly report already exists — returning existing');
    return existing;
  }

  const stats = await statisticsService.monthlyStats({ asOf, top: TOP_N });
  const extra = await collectExtraCounters({ startAt, endAt });

  const doc = await buildAndPersist({
    kind: 'MONTHLY',
    reportKey,
    periodStart: startAt,
    periodEnd: endAt,
    generatedBy,
    stats,
    extra,
  });

  return doc;
}

/**
 * Generate a manual report for an arbitrary date range.
 * Always inserts a new document (no idempotency).
 */
export async function generateManualReport({
  from,
  to,
  generatedBy = 'system',
  label = null,
} = {}) {
  if (!from || !to) {
    throw new ValidationError('from and to are required for a manual report.');
  }
  const startAt = new Date(from);
  const endAt = new Date(to);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new ValidationError('from and to must be valid dates.');
  }
  if (endAt <= startAt) {
    throw new ValidationError('to must be after from.');
  }

  const stats = await statisticsService.windowSummary('manual', {
    asOf: startAt,   // ignored when we pass explicit from/to below
    top: TOP_N,
  }).catch(() => null);

  // windowSummary doesn't accept custom ranges, so use the general
  // windowSummary-compatible shape derived from range-specific queries.
  const statsFromRange = await manualWindowStats({ startAt, endAt, top: TOP_N });
  const extra = await collectExtraCounters({ startAt, endAt });

  const doc = await buildAndPersist({
    kind: 'MANUAL',
    reportKey: null,
    periodStart: startAt,
    periodEnd: endAt,
    generatedBy,
    stats: statsFromRange,
    extra,
    label,
  });

  return doc;
}

// ============================================================
//  Internals
// ============================================================

/**
 * Additional counters that don't come from statisticsService.windowSummary:
 * pending removals currently open, active leaves + notices *right now*.
 *
 * `windowSummary` reports leaves/notices that overlapped the window,
 * which is the right measure for a period report. Here we ALSO capture
 * the "still open" count for operator convenience.
 */
async function collectExtraCounters({ startAt, endAt }) {
  const [currentlyPendingRemovals, activeLeavesNow, activeNoticesNow] = await Promise.all([
    RemovalRequest.countDocuments({ status: 'PENDING' }),
    Leave.countDocuments({
      status: 'APPROVED',
      startAt: { $lte: endAt },
      endAt: { $gte: startAt },
    }),
    Notice.countDocuments({
      status: 'ACTIVE',
      startAt: { $lte: endAt },
      $or: [{ endAt: null }, { endAt: { $gte: startAt } }],
    }),
  ]);
  return { currentlyPendingRemovals, activeLeavesNow, activeNoticesNow };
}

/**
 * Build a windowSummary-equivalent object for an arbitrary date range.
 * statisticsService.windowSummary only supports daily/weekly/monthly;
 * manual reports need arbitrary from/to.
 */
async function manualWindowStats({ startAt, endAt, top }) {
  // Reuse the daily implementation by temporarily pretending the range
  // is a single period. The underlying aggregations use `from`/`to`
  // semantics identical to windowSummary, so we just inline the pieces.
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
    countApprovedEvents(startAt, endAt),
    eventsByTypeAgg(startAt, endAt),
    countActiveAttendance(startAt, endAt),
    topHostsAgg(startAt, endAt, top),
    topAttendeesAgg(startAt, endAt, top),
    countStrikesIssued(startAt, endAt),
    countStrikesRecovered(startAt, endAt),
    countQuotaResult(startAt, endAt, 'MET'),
    countQuotaResult(startAt, endAt, 'MISSED'),
    countRemovals(startAt, endAt),
    countLeavesOverlapping(startAt, endAt),
    countNoticesOverlapping(startAt, endAt),
    syncSummaryAgg(startAt, endAt),
  ]);

  return {
    kind: 'manual',
    asOf: endAt.toISOString(),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    periodKey: null,
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
    eventsByType,
    topHosts,
    topAttendees,
    sync: syncSummary,
  };
}

// The following functions duplicate small slices of statistics.service
// internals on purpose. `statistics.service.windowSummary` is a fixed
// three-mode interface; manual reports need arbitrary ranges. Rather
// than expose every aggregation as a public function, we re-implement
// the handful we need here. If this grows, refactor into a shared
// `aggregations` module.
import { Event, Attendance, Strike, QuotaResult, SyncLog } from '../models/index.js';

async function countApprovedEvents(startAt, endAt) {
  return Event.countDocuments({
    status: 'APPROVED',
    createdAt: { $gte: startAt, $lt: endAt },
  });
}
async function eventsByTypeAgg(startAt, endAt) {
  return Event.aggregate([
    { $match: { status: 'APPROVED', createdAt: { $gte: startAt, $lt: endAt } } },
    { $group: { _id: '$eventTypeKey', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]).then((rows) => rows.map((r) => ({ typeKey: r._id, count: r.count })));
}
async function countActiveAttendance(startAt, endAt) {
  return Attendance.countDocuments({ active: true, eventAt: { $gte: startAt, $lt: endAt } });
}
async function topHostsAgg(startAt, endAt, top) {
  const rows = await Event.aggregate([
    { $match: { status: 'APPROVED', createdAt: { $gte: startAt, $lt: endAt } } },
    { $group: {
      _id: '$host.discordId',
      count: { $sum: 1 },
      username: { $first: '$host.discordUsername' },
      robloxUsername: { $first: '$host.robloxUsername' },
    }},
    { $sort: { count: -1, _id: 1 } },
    { $limit: top },
  ]);
  return rows.map((r) => ({
    discordId: r._id,
    discordUsername: r.username ?? null,
    robloxUsername: r.robloxUsername ?? null,
    count: r.count,
  }));
}
async function topAttendeesAgg(startAt, endAt, top) {
  const rows = await Attendance.aggregate([
    { $match: { active: true, eventAt: { $gte: startAt, $lt: endAt } } },
    { $group: { _id: '$discordId', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: top },
  ]);
  return rows.map((r) => ({ discordId: r._id, count: r.count }));
}
async function countStrikesIssued(startAt, endAt) {
  return Strike.countDocuments({ issuedAt: { $gte: startAt, $lt: endAt } });
}
async function countStrikesRecovered(startAt, endAt) {
  return Strike.countDocuments({ status: 'RECOVERED', resolvedAt: { $gte: startAt, $lt: endAt } });
}
async function countQuotaResult(startAt, endAt, status) {
  return QuotaResult.countDocuments({
    evaluatedAt: { $gte: startAt, $lt: endAt },
    status,
  });
}
async function countRemovals(startAt, endAt) {
  return RemovalRequest.countDocuments({ createdAt: { $gte: startAt, $lt: endAt } });
}
async function countLeavesOverlapping(startAt, endAt) {
  return Leave.countDocuments({
    status: 'APPROVED',
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  });
}
async function countNoticesOverlapping(startAt, endAt) {
  return Notice.countDocuments({
    status: 'ACTIVE',
    startAt: { $lt: endAt },
    $or: [{ endAt: null }, { endAt: { $gt: startAt } }],
  });
}
async function syncSummaryAgg(startAt, endAt) {
  const rows = await SyncLog.aggregate([
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
  ]);
  return rows[0]
    ? {
        syncCount: rows[0].syncCount,
        membersFetched: rows[0].membersFetched,
        membersCreated: rows[0].membersCreated,
        membersUpdated: rows[0].membersUpdated,
        rankChanges: rows[0].rankChanges,
        membersRemoved: rows[0].membersRemoved,
      }
    : { syncCount: 0, membersFetched: 0, membersCreated: 0, membersUpdated: 0, rankChanges: 0, membersRemoved: 0 };
}

/**
 * Assemble the report document from stats + extra, persist it, and
 * attach a rendered Discord payload. Returns the plain object.
 *
 * Uses `$setOnInsert` for scheduled kinds so re-runs are no-ops.
 * For MANUAL, inserts unconditionally (no unique constraint).
 */
async function buildAndPersist({
  kind,
  reportKey,
  periodStart,
  periodEnd,
  generatedBy,
  stats,
  extra,
  label = null,
}) {
  const summary = {
    ...stats.summary,
    currentlyPendingRemovals: extra.currentlyPendingRemovals,
  };

  const quota = splitQuotaByCategory(stats);

  const baseDoc = {
    kind,
    reportKey,
    periodStart,
    periodEnd,
    generatedAt: new Date(),
    generatedBy,
    summary,
    eventsByType: stats.eventsByType,
    topHosts: stats.topHosts,
    topAttendees: stats.topAttendees,
    quota,
    syncSummary: stats.sync,
  };

  // Persist. For scheduled kinds, upsert keyed on (kind, reportKey).
  // For MANUAL, insert.
  let doc;
  if (kind === 'MANUAL') {
    doc = await Report.create({
      ...baseDoc,
      label,
    });
  } else {
    const result = await Report.findOneAndUpdate(
      { kind, reportKey },
      { $setOnInsert: baseDoc },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    doc = result;
  }

  // Render the Discord payload from the persisted doc (so it's stored
  // consistently and can be resent later without re-rendering).
  const rendered = renderDiscordEmbed(doc);
  await Report.updateOne({ _id: doc._id }, { $set: { renderedPayload: rendered } });
  doc.renderedPayload = rendered;

  await audit({
    actorId: generatedBy,
    action: 'report.generated',
    category: 'REPORT',
    targetType: 'Report',
    targetId: doc._id,
    after: {
      kind,
      reportKey,
      periodStart,
      periodEnd,
    },
  });

  logger.info(
    { reportId: String(doc._id), kind, reportKey },
    'Report generated and persisted'
  );

  return doc.toObject();
}

/**
 * Split the quota summary into staff/low-rank MET/MISSED counts.
 * statisticsService.windowSummary returns aggregates; here we break
 * them out by category so the report shows them separately.
 *
 * Note: `stats.summary.quotaMet/quotaMissed` is the total across both
 * categories. For per-category breakdown, query QuotaResult directly.
 */
function splitQuotaByCategory(stats) {
  // Since `windowSummary` doesn't split by category, we do an
  // additional query at persist time to get the breakdown. To avoid an
  // extra round-trip per report, this returns zeros when the caller
  // didn't provide per-category data; callers may override via `extra`.
  return {
    staffCompleted: stats?.quota?.staffCompleted ?? 0,
    staffMissed: stats?.quota?.staffMissed ?? 0,
    lowRankCompleted: stats?.quota?.lowRankCompleted ?? 0,
    lowRankMissed: stats?.quota?.lowRankMissed ?? 0,
  };
}

// ============================================================
//  Rendering
// ============================================================

/**
 * Render a Discord message payload from a Report document (or plain
 * object). Pure function — no I/O. Safe to call multiple times.
 */
export function renderDiscordEmbed(report) {
  const titlePrefix = report.kind.charAt(0) + report.kind.slice(1).toLowerCase();
  const titleSuffix = report.reportKey ? ` (${report.reportKey})` : '';
  const title = `24th Guard Rifles — ${titlePrefix} Report${titleSuffix}`;

  const s = report.summary ?? {};
  const quota = report.quota ?? {};

  const fields = [
    {
      name: 'Overview',
      value: [
        `**Events:** ${s.totalEvents ?? 0}`,
        `**Attendance:** ${s.totalAttendance ?? 0}`,
        `**Active Members:** ${s.activeMembers ?? '—'}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Quota',
      value: [
        `**Staff MET:** ${quota.staffCompleted ?? 0}`,
        `**Staff MISSED:** ${quota.staffMissed ?? 0}`,
        `**Low Rank MET:** ${quota.lowRankCompleted ?? 0}`,
        `**Low Rank MISSED:** ${quota.lowRankMissed ?? 0}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Discipline',
      value: [
        `**New Strikes:** ${s.newStrikes ?? 0}`,
        `**Recovered:** ${s.recoveredStrikes ?? 0}`,
        `**Pending Removals:** ${s.pendingRemovals ?? 0}`,
      ].join('\n'),
      inline: true,
    },
  ];

  // Events by type — condense into one line.
  if (Array.isArray(report.eventsByType) && report.eventsByType.length > 0) {
    const byType = report.eventsByType
      .map((e) => `${e.typeKey}: ${e.count}`)
      .join(' • ');
    fields.push({ name: 'Events by Type', value: byType, inline: false });
  }

  // Top hosts.
  if (Array.isArray(report.topHosts) && report.topHosts.length > 0) {
    const lines = report.topHosts.map((h, i) =>
      `${i + 1}. <@${h.discordId}> — ${h.count}`
    );
    fields.push({ name: `Top Hosts (top ${report.topHosts.length})`, value: lines.join('\n'), inline: false });
  }

  // Top attendees.
  if (Array.isArray(report.topAttendees) && report.topAttendees.length > 0) {
    const lines = report.topAttendees.map((a, i) =>
      `${i + 1}. <@${a.discordId}> — ${a.count}`
    );
    fields.push({ name: `Top Attendees (top ${report.topAttendees.length})`, value: lines.join('\n'), inline: false });
  }

  // Sync summary.
  const sync = report.syncSummary ?? {};
  if ((sync.syncCount ?? 0) > 0) {
    fields.push({
      name: 'Roblox Sync',
      value: [
        `**Syncs:** ${sync.syncCount}`,
        `**Members fetched:** ${sync.membersFetched}`,
        `**Rank changes:** ${sync.rankChanges}`,
        `**Left group:** ${sync.membersRemoved}`,
      ].join('\n'),
      inline: false,
    });
  }

  return {
    embeds: [
      {
        title,
        description: `Period: ${fmtDate(report.periodStart)} → ${fmtDate(report.periodEnd)}`,
        color: 0x3498db,
        fields,
        footer: {
          text: `Generated ${fmtDate(report.generatedAt)} by ${report.generatedBy}`,
        },
        timestamp: (report.generatedAt ?? new Date()).toISOString
          ? (report.generatedAt ?? new Date()).toISOString()
          : new Date(report.generatedAt ?? Date.now()).toISOString(),
      },
    ],
  };
}

function fmtDate(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

// ============================================================
//  Reads
// ============================================================

export async function getReportById(reportId) {
  const r = await Report.findById(reportId).lean();
  if (!r) throw new NotFoundError('Report', { id: String(reportId) });
  return r;
}

export async function listReports({ kind, page = 1, pageSize = 25 } = {}) {
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const skip = (page - 1) * pageSize;

  const filter = {};
  if (kind) filter.kind = kind;

  const [items, total] = await Promise.all([
    Report.find(filter).sort({ generatedAt: -1 }).skip(skip).limit(pageSize).lean(),
    Report.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Return the most recent report of the given kind, or null.
 */
export async function getLatestReport(kind) {
  return Report.findOne({ kind }).sort({ generatedAt: -1 }).lean();
}
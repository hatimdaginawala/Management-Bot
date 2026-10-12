import * as reportRepo from '../db/repositories/report.repository.js';
import * as statisticsService from './statistics.service.js';
import * as leaveRepo from '../db/repositories/leave.repository.js';
import * as noticeRepo from '../db/repositories/notice.repository.js';
import * as removalRequestRepo from '../db/repositories/removalRequest.repository.js';
import * as userRepo from '../db/repositories/user.repository.js';
import { audit } from '../utils/audit.js';
import { isoWeekKey, isoWeekBounds } from '../utils/isoWeek.js';
import {
  ValidationError,
  NotFoundError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Report service. Public API unchanged.
 */

const TOP_N = 5;

// ============================================================
//  Public API
// ============================================================

export async function generateWeeklyReport({ asOf = new Date(), generatedBy = 'system' } = {}) {
  const { startAt, endAt } = isoWeekBounds(asOf);
  const reportKey = isoWeekKey(asOf);

  const existing = await reportRepo.findScheduled('WEEKLY', reportKey);
  if (existing) {
    logger.info({ reportKey }, 'Weekly report already exists — returning existing');
    return existing;
  }

  const stats = await statisticsService.weeklyStats({ asOf, top: TOP_N });
  const extra = await collectExtraCounters({ startAt, endAt });

  return buildAndPersist({
    kind: 'WEEKLY',
    reportKey,
    periodStart: startAt,
    periodEnd: endAt,
    generatedBy,
    stats,
    extra,
  });
}

export async function generateMonthlyReport({ asOf = new Date(), generatedBy = 'system' } = {}) {
  const d = new Date(asOf);
  const startAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const endAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const reportKey =
    d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');

  const existing = await reportRepo.findScheduled('MONTHLY', reportKey);
  if (existing) {
    logger.info({ reportKey }, 'Monthly report already exists — returning existing');
    return existing;
  }

  const stats = await statisticsService.monthlyStats({ asOf, top: TOP_N });
  const extra = await collectExtraCounters({ startAt, endAt });

  return buildAndPersist({
    kind: 'MONTHLY',
    reportKey,
    periodStart: startAt,
    periodEnd: endAt,
    generatedBy,
    stats,
    extra,
  });
}

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

  const stats = await manualWindowStats({ startAt, endAt, top: TOP_N });
  const extra = await collectExtraCounters({ startAt, endAt });

  return buildAndPersist({
    kind: 'MANUAL',
    reportKey: null,
    periodStart: startAt,
    periodEnd: endAt,
    generatedBy,
    stats,
    extra,
    label,
  });
}

// ============================================================
//  Internals
// ============================================================

async function collectExtraCounters({ startAt, endAt }) {
  const [pendingRemovals, activeLeaves, activeNotices] = await Promise.all([
    removalRequestRepo.countPending(),
    leaveRepo.findOverlappingApprovedInPeriod({ start_at: startAt, end_at: endAt })
      .then((ids) => ids.length),
    noticeRepo.countActiveInRange({ from: startAt, to: endAt }),
  ]);
  return { currentlyPendingRemovals: pendingRemovals, activeLeavesNow: activeLeaves, activeNoticesNow: activeNotices };
}

async function manualWindowStats({ startAt, endAt, top }) {
  // Reuse statistics service's helpers by delegating to eventStats/attendanceStats.
  // We don't have a single windowSummary for arbitrary ranges in the
  // statistics service, so we build one here using the same primitives.
  const [
    eventsByStatus,
    eventsByType,
    attendanceCounts,
    topHosts,
    topAttendees,
  ] = await Promise.all([
    (await import('../db/repositories/event.repository.js')).countByStatusInRange({ from: startAt, to: endAt }),
    (await import('../db/repositories/event.repository.js')).countByTypeInRange({ from: startAt, to: endAt }),
    (await import('../db/repositories/attendance.repository.js')).distinctCountsInRange({ from: startAt, to: endAt }),
    (await import('../db/repositories/event.repository.js')).topHostsInRange({ from: startAt, to: endAt, limit: top }),
    (await import('../db/repositories/attendance.repository.js')).topAttendeesInRange({ from: startAt, to: endAt, limit: top }),
  ]);

  const totalEvents = eventsByStatus.APPROVED || 0;

  return {
    kind: 'manual',
    asOf: endAt.toISOString(),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    periodKey: null,
    summary: {
      totalEvents,
      totalAttendance: attendanceCounts.total,
      newStrikes: 0,
      recoveredStrikes: 0,
      pendingRemovals: 0,
      activeLeaves: 0,
      activeNotices: 0,
      quotaMet: 0,
      quotaMissed: 0,
    },
    eventsByType,
    topHosts,
    topAttendees,
    sync: { syncCount: 0, membersFetched: 0, membersCreated: 0, membersUpdated: 0, rankChanges: 0, membersRemoved: 0 },
  };
}

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
    activeMembers: extra.currentlyPendingRemovals != null ? undefined : undefined,
    totalEvents: stats.summary?.totalEvents ?? 0,
    totalAttendance: stats.summary?.totalAttendance ?? 0,
    newStrikes: stats.summary?.newStrikes ?? 0,
    recoveredStrikes: stats.summary?.recoveredStrikes ?? 0,
    pendingRemovals: stats.summary?.pendingRemovals ?? 0,
    activeLeaves: stats.summary?.activeLeaves ?? 0,
    activeNotices: stats.summary?.activeNotices ?? 0,
  };

  const quota = {
    staffCompleted: 0,
    staffMissed: 0,
    lowRankCompleted: 0,
    lowRankMissed: 0,
  };

  const report = await reportRepo.create({
    kind,
    reportKey,
    periodStart,
    periodEnd,
    generatedAt: new Date(),
    generatedBy,
    label,
    summary,
    quota,
    eventsByType: stats.eventsByType ?? [],
    topHosts: stats.topHosts ?? [],
    topAttendees: stats.topAttendees ?? [],
    syncSummary: stats.sync ?? {},
  });

  // Render and attach the Discord payload.
  const rendered = renderDiscordEmbed(report);
  await reportRepo.setRenderedPayload(report.id, rendered);
  report.rendered_payload_json = rendered;

  await audit({
    actorId: generatedBy,
    action: 'report.generated',
    category: 'REPORT',
    targetType: 'Report',
    targetId: report.id,
    after: { kind, reportKey, periodStart, periodEnd },
  });

  logger.info(
    { reportId: report.id, kind, reportKey },
    'Report generated and persisted'
  );

  return report;
}

// ============================================================
//  Rendering
// ============================================================

export function renderDiscordEmbed(report) {
  const titlePrefix = report.kind.charAt(0) + report.kind.slice(1).toLowerCase();
  const titleSuffix = report.report_key ? ' (' + report.report_key + ')' : '';
  const title = '24th Guard Rifles — ' + titlePrefix + ' Report' + titleSuffix;

  const summary = {
    totalEvents: report.total_events ?? 0,
    totalAttendance: report.total_attendance ?? 0,
    newStrikes: report.new_strikes ?? 0,
    recoveredStrikes: report.recovered_strikes ?? 0,
    pendingRemovals: report.pending_removals ?? 0,
    activeLeaves: report.active_leaves ?? 0,
    activeNotices: report.active_notices ?? 0,
  };

  const quota = {
    staffCompleted: report.staff_completed ?? 0,
    staffMissed: report.staff_missed ?? 0,
    lowRankCompleted: report.low_rank_completed ?? 0,
    lowRankMissed: report.low_rank_missed ?? 0,
  };

  const fields = [
    {
      name: 'Overview',
      value: [
        '**Events:** ' + summary.totalEvents,
        '**Attendance:** ' + summary.totalAttendance,
        '**Active Members:** —',
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Quota',
      value: [
        '**Staff MET:** ' + quota.staffCompleted,
        '**Staff MISSED:** ' + quota.staffMissed,
        '**Low Rank MET:** ' + quota.lowRankCompleted,
        '**Low Rank MISSED:** ' + quota.lowRankMissed,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Discipline',
      value: [
        '**New Strikes:** ' + summary.newStrikes,
        '**Recovered:** ' + summary.recoveredStrikes,
        '**Pending Removals:** ' + summary.pendingRemovals,
      ].join('\n'),
      inline: true,
    },
  ];

  const byType = Array.isArray(report.events_by_type_json) ? report.events_by_type_json : [];
  if (byType.length > 0) {
    fields.push({
      name: 'Events by Type',
      value: byType.map((e) => (e.typeKey || e._id) + ': ' + e.count).join(' • '),
      inline: false,
    });
  }

  const topHosts = Array.isArray(report.top_hosts_json) ? report.top_hosts_json : [];
  if (topHosts.length > 0) {
    fields.push({
      name: 'Top Hosts (top ' + topHosts.length + ')',
      value: topHosts.map((h, i) => (i + 1) + '. <@' + h.discordId + '> — ' + h.count).join('\n'),
      inline: false,
    });
  }

  const topAttendees = Array.isArray(report.top_attendees_json) ? report.top_attendees_json : [];
  if (topAttendees.length > 0) {
    fields.push({
      name: 'Top Attendees (top ' + topAttendees.length + ')',
      value: topAttendees.map((a, i) => (i + 1) + '. <@' + a.discordId + '> — ' + a.count).join('\n'),
      inline: false,
    });
  }

  return {
    embeds: [
      {
        title,
        description:
          'Period: ' + fmtDate(report.period_start) + ' → ' + fmtDate(report.period_end),
        color: 0x3498db,
        fields,
        footer: {
          text: 'Generated ' + fmtDate(report.generated_at) + ' by ' + report.generated_by,
        },
        timestamp: new Date(report.generated_at).toISOString(),
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
  const r = await reportRepo.findById(reportId);
  if (!r) throw new NotFoundError('Report', { id: String(reportId) });
  return r;
}

export async function listReports({ kind, page = 1, pageSize = 25 } = {}) {
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));

  const { items, total } = await reportRepo.list({ kind, page, pageSize });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getLatestReport(kind) {
  return reportRepo.findLatest(kind);
}
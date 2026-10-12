import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const JSON_FIELDS = [
  'events_by_type_json',
  'top_hosts_json',
  'top_attendees_json',
  'sync_summary_json',
  'rendered_payload_json',
];
const CTX = { repository: 'report' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('reports').where({ id }).first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'findById' });
}

/**
 * Find a scheduled report by (kind, reportKey).
 * Manual reports (report_key NULL) are never matched.
 */
export async function findScheduled(kind, reportKey) {
  return withDbErrors(async () => {
    const row = await db('reports')
      .where({ kind, report_key: reportKey })
      .first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'findScheduled' });
}

/**
 * Insert a report row.
 */
export async function create(data) {
  return withDbErrors(async () => {
    const [id] = await db('reports').insert({
      kind: data.kind,
      report_key: data.reportKey ?? null,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      generated_at: data.generatedAt ?? new Date(),
      generated_by: data.generatedBy ?? 'system',
      channel_id: data.channelId ?? null,
      message_id: data.messageId ?? null,
      label: data.label ?? null,

      active_members: data.summary?.activeMembers ?? 0,
      total_events: data.summary?.totalEvents ?? 0,
      total_attendance: data.summary?.totalAttendance ?? 0,
      new_strikes: data.summary?.newStrikes ?? 0,
      recovered_strikes: data.summary?.recoveredStrikes ?? 0,
      pending_removals: data.summary?.pendingRemovals ?? 0,
      active_leaves: data.summary?.activeLeaves ?? 0,
      active_notices: data.summary?.activeNotices ?? 0,

      staff_completed: data.quota?.staffCompleted ?? 0,
      staff_missed: data.quota?.staffMissed ?? 0,
      low_rank_completed: data.quota?.lowRankCompleted ?? 0,
      low_rank_missed: data.quota?.lowRankMissed ?? 0,

      events_by_type_json: JSON.stringify(data.eventsByType ?? []),
      top_hosts_json: JSON.stringify(data.topHosts ?? []),
      top_attendees_json: JSON.stringify(data.topAttendees ?? []),
      sync_summary_json: JSON.stringify(data.syncSummary ?? {}),
      rendered_payload_json: data.renderedPayload != null
        ? JSON.stringify(data.renderedPayload)
        : null,
    });
    const row = await db('reports').where({ id }).first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'create' });
}

/**
 * Update channel/message id after the report is posted.
 */
export async function setPosted(id, { channelId, messageId }) {
  return withDbErrors(async () => {
    await db('reports').where({ id }).update({
      channel_id: channelId ?? null,
      message_id: messageId ?? null,
    });
    const row = await db('reports').where({ id }).first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'setPosted' });
}

/**
 * Update the stored rendered payload (rarely used).
 */
export async function setRenderedPayload(id, payload) {
  return withDbErrors(async () => {
    await db('reports').where({ id }).update({
      rendered_payload_json: JSON.stringify(payload),
    });
    const row = await db('reports').where({ id }).first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'setRenderedPayload' });
}

/**
 * List reports with pagination.
 */
export async function list({ kind, page = 1, pageSize = 25 } = {}) {
  return withDbErrors(async () => {
    const q = db('reports');
    if (kind) q.where('kind', kind);

    const [countRow] = await q.clone().count({ count: '*' });
    const total = Number(countRow.count);

    const offset = (Math.max(1, page) - 1) * pageSize;
    const rows = await q
      .clone()
      .orderBy('generated_at', 'desc')
      .limit(pageSize)
      .offset(offset);

    return { items: convertRows(rows, { jsonFields: JSON_FIELDS }), total };
  }, { ...CTX, method: 'list' });
}

/**
 * Find the most recent report of a kind.
 */
export async function findLatest(kind) {
  return withDbErrors(async () => {
    const row = await db('reports')
      .where({ kind })
      .orderBy('generated_at', 'desc')
      .first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'findLatest' });
}
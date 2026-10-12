import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const JSON_FIELDS = ['before_json', 'after_json', 'context_json'];
const CTX = { repository: 'auditLog' };

/**
 * Create an audit log entry.
 *
 * Audit logs are append-only — there is no update or delete.
 */
export async function create(data) {
  return withDbErrors(async () => {
    const [id] = await db('audit_logs').insert({
      actor_id: data.actorId,
      action: data.action,
      category: data.category,
      target_type: data.targetType,
      target_id: data.targetId ? String(data.targetId) : null,
      before_json: data.before != null ? JSON.stringify(data.before) : null,
      after_json: data.after != null ? JSON.stringify(data.after) : null,
      context_json: data.context != null ? JSON.stringify(data.context) : null,
      reason: data.reason ?? null,
    });
    const row = await db('audit_logs').where({ id }).first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'create' });
}

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('audit_logs').where({ id }).first();
    return convertRow(row, { jsonFields: JSON_FIELDS });
  }, { ...CTX, method: 'findById' });
}

/**
 * Filtered query with pagination.
 * Returns { items, total }.
 */
export async function query({
  actorId,
  action,
  category,
  targetType,
  targetId,
  from,
  to,
  page = 1,
  pageSize = 25,
} = {}) {
  return withDbErrors(async () => {
    const q = db('audit_logs');
    if (actorId) q.where('actor_id', actorId);
    if (action) q.where('action', action);
    if (category) q.where('category', category);
    if (targetType) q.where('target_type', targetType);
    if (targetId) q.where('target_id', String(targetId));
    if (from) q.where('created_at', '>=', from);
    if (to) q.where('created_at', '<', to);

    const [countRow] = await q.clone().count({ count: '*' });
    const total = Number(countRow.count);

    const offset = (Math.max(1, page) - 1) * pageSize;
    const rows = await q
      .clone()
      .orderBy('created_at', 'desc')
      .limit(pageSize)
      .offset(offset);

    return { items: convertRows(rows, { jsonFields: JSON_FIELDS }), total };
  }, { ...CTX, method: 'query' });
}

/**
 * Group by category (used by /audit summary).
 */
export async function groupByCategory({ from, to } = {}) {
  return withDbErrors(async () => {
    const q = db('audit_logs');
    if (from) q.where('created_at', '>=', from);
    if (to) q.where('created_at', '<', to);
    const rows = await q
      .groupBy('category')
      .select('category')
      .count({ count: '*' })
      .orderBy('count', 'desc');
    return rows.map((r) => ({ category: r.category, count: Number(r.count) }));
  }, { ...CTX, method: 'groupByCategory' });
}

/**
 * Group by action.
 */
export async function groupByAction({ category = null, from, to } = {}) {
  return withDbErrors(async () => {
    const q = db('audit_logs');
    if (category) q.where('category', category);
    if (from) q.where('created_at', '>=', from);
    if (to) q.where('created_at', '<', to);
    const rows = await q
      .groupBy('action')
      .select('action')
      .count({ count: '*' })
      .orderBy('count', 'desc');
    return rows.map((r) => ({ action: r.action, count: Number(r.count) }));
  }, { ...CTX, method: 'groupByAction' });
}

/**
 * Group by actor. Limited to top N.
 */
export async function groupByActor({ from, to, limit = 20 } = {}) {
  return withDbErrors(async () => {
    const q = db('audit_logs');
    if (from) q.where('created_at', '>=', from);
    if (to) q.where('created_at', '<', to);
    const rows = await q
      .groupBy('actor_id')
      .select('actor_id')
      .count({ count: '*' })
      .orderBy('count', 'desc')
      .limit(limit);
    return rows.map((r) => ({ actorId: r.actor_id, count: Number(r.count) }));
  }, { ...CTX, method: 'groupByActor' });
}

/**
 * Total count in a window.
 */
export async function countInWindow({ from, to } = {}) {
  return withDbErrors(async () => {
    const q = db('audit_logs');
    if (from) q.where('created_at', '>=', from);
    if (to) q.where('created_at', '<', to);
    const [row] = await q.count({ count: '*' });
    return Number(row.count);
  }, { ...CTX, method: 'countInWindow' });
}
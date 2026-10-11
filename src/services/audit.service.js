import { AuditLog } from '../models/index.js';
import { AUDIT_CATEGORY } from '../models/enums.js';
import {
  ValidationError,
  NotFoundError,
} from '../utils/errors.js';

/**
 * Audit log service — read-only.
 *
 * The writer is `src/utils/audit.js::audit()`. This module never writes.
 * It exists so `/audit view`, future REST endpoints, and any future
 * dashboard can query the audit trail without duplicating Mongo logic.
 *
 * All functions return plain JS objects. All list endpoints paginate.
 */

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

// ============================================================
//  Single entry
// ============================================================

export async function getEntry(entryId) {
  if (!entryId) throw new ValidationError('entryId is required.');
  const entry = await AuditLog.findById(entryId).lean();
  if (!entry) throw new NotFoundError('AuditLog', { id: String(entryId) });
  return entry;
}

// ============================================================
//  Filtered query
// ============================================================

/**
 * Query audit logs with any combination of filters.
 *
 * Filters (all optional):
 *   actorId
 *   action           exact key (e.g. "role.created")
 *   category         AUDIT_CATEGORY enum value
 *   targetType       e.g. "Role", "User", "Event"
 *   targetId
 *   from, to         inclusive/exclusive on createdAt
 *   page, pageSize
 *
 * Returns { items, total, page, pageSize, totalPages }.
 */
export async function queryLogs({
  actorId,
  action,
  category,
  targetType,
  targetId,
  from,
  to,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const filter = {};
  if (actorId) filter.actorId = String(actorId);
  if (action) filter.action = String(action);
  if (category) {
    if (!Object.values(AUDIT_CATEGORY).includes(category)) {
      throw new ValidationError(`Unknown audit category: ${category}`);
    }
    filter.category = category;
  }
  if (targetType) filter.targetType = String(targetType);
  if (targetId) filter.targetId = String(targetId);

  if (from || to) {
    filter.createdAt = {};
    if (from) {
      const f = toDate(from, 'from');
      filter.createdAt.$gte = f;
    }
    if (to) {
      const t = toDate(to, 'to');
      filter.createdAt.$lt = t;
    }
  }

  const { skip, limit, normalizedPage, normalizedPageSize } = paginate(page, pageSize);

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}

// ============================================================
//  Menu helpers
// ============================================================

/**
 * Return the list of categories that have at least one log entry.
 * Ordered alphabetically. Used to populate a select menu.
 */
export async function listCategories() {
  const rows = await AuditLog.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => ({ category: r._id, count: r.count }));
}

/**
 * Return distinct actions, optionally scoped to a category.
 * Ordered by frequency DESC then name ASC.
 */
export async function listActions({ category = null } = {}) {
  const match = {};
  if (category) {
    if (!Object.values(AUDIT_CATEGORY).includes(category)) {
      throw new ValidationError(`Unknown audit category: ${category}`);
    }
    match.category = category;
  }

  const rows = await AuditLog.aggregate([
    { $match: match },
    { $group: { _id: '$action', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
  return rows.map((r) => ({ action: r._id, count: r.count }));
}

// ============================================================
//  Targeted reads
// ============================================================

/**
 * History for a specific target document (e.g. a Role, Event, User).
 * Returns newest first, paginated.
 */
export async function historyForTarget({
  targetType,
  targetId,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  if (!targetType) throw new ValidationError('targetType is required.');
  if (!targetId) throw new ValidationError('targetId is required.');
  return queryLogs({ targetType, targetId, page, pageSize });
}

/**
 * Activity by a specific actor (Discord ID or "system"), optionally
 * filtered to a date range.
 */
export async function activityByActor({
  actorId,
  from = null,
  to = null,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  if (!actorId) throw new ValidationError('actorId is required.');
  return queryLogs({ actorId, from, to, page, pageSize });
}

// ============================================================
//  Summary
// ============================================================

/**
 * Aggregate counts for a time window.
 *
 * Returns:
 *   {
 *     total,
 *     byCategory:  [{ category, count }],
 *     byAction:    [{ action, count }],
 *     byActor:     [{ actorId, count }],
 *   }
 *
 * The `byActor` list is capped at 20 entries; the others are unbounded
 * (categories and actions are small fixed sets).
 */
export async function summarize({ from = null, to = null } = {}) {
  const match = {};
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = toDate(from, 'from');
    if (to) match.createdAt.$lt = toDate(to, 'to');
  }

  const [total, byCategory, byAction, byActor] = await Promise.all([
    AuditLog.countDocuments(match),
    AuditLog.aggregate([
      { $match: match },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    AuditLog.aggregate([
      { $match: match },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    AuditLog.aggregate([
      { $match: match },
      { $group: { _id: '$actorId', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 20 },
    ]),
  ]);

  return {
    total,
    byCategory: byCategory.map((r) => ({ category: r._id, count: r.count })),
    byAction: byAction.map((r) => ({ action: r._id, count: r.count })),
    byActor: byActor.map((r) => ({ actorId: r._id, count: r.count })),
  };
}

// ============================================================
//  Helpers
// ============================================================

function paginate(page, pageSize) {
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedPageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE)
  );
  const skip = (normalizedPage - 1) * normalizedPageSize;
  return {
    skip,
    limit: normalizedPageSize,
    normalizedPage,
    normalizedPageSize,
  };
}

function toDate(value, fieldName) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid date.`);
  }
  return d;
}
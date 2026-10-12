import * as auditRepo from '../db/repositories/auditLog.repository.js';
import { AUDIT_CATEGORY } from '../models/enums.js';
import {
  ValidationError,
  NotFoundError,
} from '../utils/errors.js';

/**
 * Audit log service. Public API unchanged.
 */

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

export async function getEntry(entryId) {
  if (!entryId) throw new ValidationError('entryId is required.');
  const entry = await auditRepo.findById(entryId);
  if (!entry) throw new NotFoundError('AuditLog', { id: String(entryId) });
  return entry;
}

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
  if (category && !Object.values(AUDIT_CATEGORY).includes(category)) {
    throw new ValidationError('Unknown audit category: ' + category);
  }

  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedPageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE)
  );

  const fromDate = from ? toDate(from, 'from') : undefined;
  const toDateVal = to ? toDate(to, 'to') : undefined;

  const { items, total } = await auditRepo.query({
    actorId,
    action,
    category,
    targetType,
    targetId,
    from: fromDate,
    to: toDateVal,
    page: normalizedPage,
    pageSize: normalizedPageSize,
  });

  return {
    items,
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}

export async function listCategories() {
  return auditRepo.groupByCategory({});
}

export async function listActions({ category = null } = {}) {
  if (category && !Object.values(AUDIT_CATEGORY).includes(category)) {
    throw new ValidationError('Unknown audit category: ' + category);
  }
  return auditRepo.groupByAction({ category });
}

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

export async function summarize({ from = null, to = null } = {}) {
  const fromDate = from ? toDate(from, 'from') : undefined;
  const toDateVal = to ? toDate(to, 'to') : undefined;

  const [total, byCategory, byAction, byActor] = await Promise.all([
    auditRepo.countInWindow({ from: fromDate, to: toDateVal }),
    auditRepo.groupByCategory({ from: fromDate, to: toDateVal }),
    auditRepo.groupByAction({ from: fromDate, to: toDateVal }),
    auditRepo.groupByActor({ from: fromDate, to: toDateVal, limit: 20 }),
  ]);

  return { total, byCategory, byAction, byActor };
}

function toDate(value, fieldName) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(fieldName + ' must be a valid date.');
  }
  return d;
}
import { AuditLog } from '../models/index.js';
import logger from '../config/logger.js';

/**
 * Write an audit-log entry.
 *
 * Phase 3: real write to the AuditLog collection.
 * Phase 16: will add enrichment (actor username lookup, IP capture,
 *           channel context, batch writes) without changing this signature.
 *
 * Never throws into the caller. If audit logging fails, the failure is
 * logged but the original operation is NOT rolled back — audit is
 * best-effort observability, not a transaction. This is documented in
 * `.txt` §35 ("every important administrative action must be audited")
 * with the pragmatic caveat that audit failures must not break the app.
 */
export async function audit({
  actorId,
  action,
  category,
  targetType,
  targetId = null,
  before = null,
  after = null,
  reason = null,
  context = null,
}) {
  try {
    await AuditLog.create({
      actorId: actorId || 'system',
      action,
      category,
      targetType,
      targetId: targetId ? String(targetId) : null,
      before,
      after,
      reason,
      context,
    });
  } catch (err) {
    logger.error(
      { err: err.message, action, category, targetType, targetId },
      'Audit write failed (operation was NOT rolled back)'
    );
  }
}
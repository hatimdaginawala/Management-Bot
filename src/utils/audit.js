import * as auditLogRepo from '../db/repositories/auditLog.repository.js';
import logger from '../config/logger.js';

/**
 * Write an audit-log entry.
 *
 * Best-effort: never throws into the caller. If the write fails, the
 * failure is logged but the original operation is NOT rolled back.
 * This is documented in .txt §35 — every important administrative
 * action must be audited, with the pragmatic caveat that audit
 * failures must not break the app.
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
    await auditLogRepo.create({
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
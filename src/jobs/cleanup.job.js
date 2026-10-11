import {
  Verification,
  Report,
} from '../models/index.js';
import logger from '../config/logger.js';

/**
 * Cleanup job.
 *
 * Bounded, non-destructive cleanup of ephemeral artifacts. Runs daily.
 *
 * Two scopes today:
 *   1. CANCELLED/FAILED/EXPIRED verifications older than 30 days.
 *      (Keeps the collection from growing unbounded.)
 *   2. Nothing else — historical records (events, strikes, attendance,
 *      audits, rank history, reports, etc.) are NEVER deleted by design.
 *
 * The 30-day retention for old verifications is configurable via a
 * constant; adjust in a future phase if needed.
 *
 * Note: AuditLog is append-only and cannot be deleted. The verification
 * records being pruned here are NOT audit entries; their removal does
 * not affect the audit trail (which retains the linked/verified events).
 */
export const name = 'cleanup';

const VERIFICATION_RETENTION_DAYS = 30;

export async function run({ asOf = new Date() } = {}) {
  const cutoff = new Date(asOf.getTime() - VERIFICATION_RETENTION_DAYS * 86_400_000);

  const result = await Verification.deleteMany({
    status: { $in: ['CANCELLED', 'FAILED', 'EXPIRED'] },
    createdAt: { $lte: cutoff },
  });

  const deleted = result.deletedCount ?? 0;
  if (deleted > 0) {
    logger.info({ deleted, retentionDays: VERIFICATION_RETENTION_DAYS }, 'Cleanup complete');
  }
  return { verificationsDeleted: deleted };
}
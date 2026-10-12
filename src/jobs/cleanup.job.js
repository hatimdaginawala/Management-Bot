import * as verificationRepo from '../db/repositories/verification.repository.js';
import logger from '../config/logger.js';

export const name = 'cleanup';

const VERIFICATION_RETENTION_DAYS = 30;

export async function run({ asOf = new Date() } = {}) {
  const cutoff = new Date(asOf.getTime() - VERIFICATION_RETENTION_DAYS * 86_400_000);

  const deleted = await verificationRepo.deleteOldTerminal(cutoff);

  if (deleted > 0) {
    logger.info(
      { deleted, retentionDays: VERIFICATION_RETENTION_DAYS },
      'Cleanup complete'
    );
  }
  return { verificationsDeleted: deleted };
}
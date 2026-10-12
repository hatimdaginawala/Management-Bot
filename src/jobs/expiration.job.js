import * as leaveService from '../services/leave.service.js';
import * as leaveRepo from '../db/repositories/leave.repository.js';
import * as noticeService from '../services/notice.service.js';
import * as verificationRepo from '../db/repositories/verification.repository.js';
import { dmLeaveUser } from '../bot/utils/leaveDm.js';
import { COLORS } from '../bot/embedBuilders.js';
import logger from '../config/logger.js';

export const name = 'expiration-sweep';

export async function run({ client = null } = {}) {
  const now = new Date();

  // ---------- Leaves ----------
  // Pre-fetch the leaves that are about to expire so we can DM each user.
  const dueLeaves = client
    ? await leaveRepo.findDueForExpiry(now)
    : [];

  const leavesExpired = await leaveService.expireLeaves({ asOf: now });

  if (client && dueLeaves.length > 0) {
    for (const leave of dueLeaves) {
      await dmLeaveUser(client, leave, {
        title: 'Leave Ended',
        color: COLORS.INFO,
        extraLine:
          'Your leave has ended. You are once again subject to weekly quota — welcome back!',
      });
    }
  }

  // ---------- Notices ----------
  const noticesExpired = await noticeService.expireNotices({ asOf: now });

  // ---------- Verifications ----------
  const verificationsExpired = await verificationRepo.expireDue(now);

  if (leavesExpired || noticesExpired || verificationsExpired) {
    logger.info(
      { leavesExpired, noticesExpired, verificationsExpired },
      'Expiration sweep complete'
    );
  }

  return { leavesExpired, noticesExpired, verificationsExpired };
}
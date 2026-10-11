import { expireLeaves } from '../services/leave.service.js';
import { expireNotices } from '../services/notice.service.js';
import { Verification, Leave } from '../models/index.js';
import { dmLeaveUser } from '../bot/utils/leaveDm.js';
import { COLORS } from '../bot/embedBuilders.js';
import logger from '../config/logger.js';

export const name = 'expiration-sweep';

export async function run({ client = null } = {}) {
  const now = new Date();

  // ---------- Leaves ----------
  // Pre-fetch the leaves that are about to expire so we can DM each user.
  const dueLeaves = client
    ? await Leave.find({
        status: 'APPROVED',
        endAt: { $lte: now },
      })
        .select('_id discordId startAt endAt reason status')
        .lean()
    : [];

  const leavesExpired = await expireLeaves({ asOf: now });

  if (client && dueLeaves.length > 0) {
    for (const leave of dueLeaves) {
      await dmLeaveUser(client, leave, {
        title: 'Leave Ended',
        color: COLORS.INFO,
        extraLine: 'Your leave has ended. You are once again subject to weekly quota — welcome back!',
      });
    }
  }

  // ---------- Notices ----------
  const noticesExpired = await expireNotices({ asOf: now });

  // ---------- Verifications ----------
  const verificationsExpired = await Verification.updateMany(
    { status: 'PENDING', expiresAt: { $lte: now } },
    { $set: { status: 'EXPIRED', failureReason: 'Code expired (sweep)' } }
  ).then((r) => r.modifiedCount ?? 0);

  if (leavesExpired || noticesExpired || verificationsExpired) {
    logger.info(
      { leavesExpired, noticesExpired, verificationsExpired },
      'Expiration sweep complete'
    );
  }

  return { leavesExpired, noticesExpired, verificationsExpired };
}
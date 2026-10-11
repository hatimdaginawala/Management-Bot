import {
  findDueRemovals,
  applyRemoval,
} from '../services/removalRequest.service.js';
import { getSettings } from '../services/settings.service.js';
import logger from '../config/logger.js';

/**
 * Removal sweep.
 *
 * Runs daily (default: 00:05 IST). For every APPROVED removal request
 * whose `removalEffectiveAt` has passed and which hasn't yet been
 * applied:
 *   - Transition the user to LEFT_ROBLOX_GROUP
 *   - Unassign all active roles
 *   - DM the user (if configured and client is available)
 *   - Ping the configured channel
 *
 * Idempotent: `applyRemoval` CAS-guards on `appliedAt: null`.
 */
export const name = 'removal-sweep';

export async function run({ client = null, actorId = 'system' } = {}) {
  const due = await findDueRemovals();

  if (due.length === 0) return { applied: 0 };

  const settings = await getSettings();
  const dmEnabled = settings?.notifications?.dmAffectedUser ?? true;
  const pingEnabled = settings?.notifications?.pingChannel ?? true;
  const notificationChannelId =
    settings?.channels?.auditChannelId ??
    settings?.channels?.removalApprovalChannelId ??
    null;

  let applied = 0;
  const errors = [];

  for (const req of due) {
    try {
      const result = await applyRemoval(req._id, { actorId });
      if (!result.applied) continue;
      applied++;

      // --- DM the user ---
// inside removalSweep.job.js, replace the DM section with:
if (client && result.user?.discordId) {
  const { sendUserDm } = await import('../bot/utils/userDm.js');
  const { COLORS } = await import('../bot/embedBuilders.js');
  await sendUserDm(client, {
    discordId: result.user.discordId,
    title: 'Removal Applied',
    color: COLORS.ERROR,
    description:
      'Your removal has taken effect. You have been marked as having left the group, ' +
      'and your internal roles have been unassigned.',
    fields: [
      ...(result.unassignedRoles?.length
        ? [{ name: 'Roles Removed', value: result.unassignedRoles.map((r) => '`' + r + '`').join(', '), inline: false }]
        : []),
    ],
  });
}

      // --- Ping the channel ---
      if (client && pingEnabled && notificationChannelId) {
        try {
          const channel = await client.channels.fetch(notificationChannelId);
          if (channel?.isTextBased?.()) {
            await channel.send({
              content: `<@${result.user.discordId}> — removal applied. Roles unassigned: ${result.unassignedRoles.join(', ') || 'none'}.`,
            });
          }
        } catch (pingErr) {
          logger.warn(
            { channelId: notificationChannelId, err: pingErr.message },
            'Removal channel ping failed'
          );
        }
      }
    } catch (err) {
      errors.push({ requestId: String(req._id), err: err.message });
      logger.error(
        { requestId: String(req._id), err: err.message },
        'Removal application failed'
      );
    }
  }

  return { applied, errors };
}
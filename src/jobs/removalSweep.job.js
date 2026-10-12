import * as removalRequestService from '../services/removalRequest.service.js';
import * as settingsRepo from '../db/repositories/settings.repository.js';
import { sendUserDm } from '../bot/utils/userDm.js';
import { COLORS } from '../bot/embedBuilders.js';
import logger from '../config/logger.js';

export const name = 'removal-sweep';

export async function run({ client = null, actorId = 'system' } = {}) {
  const due = await removalRequestService.findDueRemovals();

  if (due.length === 0) return { applied: 0 };

  // Read notification settings from the DB
  const dmRow = await settingsRepo.findByKey('notifications.dmAffectedUser');
  const pingRow = await settingsRepo.findByKey('notifications.pingChannel');
  const channelRow = await settingsRepo.findByKey('channels.auditChannelId');

  const dmEnabled = dmRow ? JSON.parse(dmRow.value_json) : true;
  const pingEnabled = pingRow ? JSON.parse(pingRow.value_json) : true;
  const notificationChannelId = channelRow ? JSON.parse(channelRow.value_json) : null;

  let applied = 0;
  const errors = [];

  for (const req of due) {
    try {
      const result = await removalRequestService.applyRemoval(req.id, { actorId });
      if (!result.applied) continue;
      applied++;

      // DM the user
      if (client && dmEnabled && result.user?.discord_id) {
        await sendUserDm(client, {
          discordId: result.user.discord_id,
          title: 'Removal Applied',
          color: COLORS.ERROR,
          description:
            'Your removal has taken effect. You have been marked as having left the group, ' +
            'and your internal roles have been unassigned.',
          fields: result.unassignedRoles?.length
            ? [{
                name: 'Roles Removed',
                value: result.unassignedRoles.map((r) => '`' + r + '`').join(', '),
                inline: false,
              }]
            : [],
        });
      }

      // Ping the channel
      if (client && pingEnabled && notificationChannelId && result.user?.discord_id) {
        try {
          const channel = await client.channels.fetch(notificationChannelId);
          if (channel?.isTextBased?.()) {
            await channel.send({
              content:
                '<@' + result.user.discord_id + '> — removal applied. Roles unassigned: ' +
                (result.unassignedRoles.join(', ') || 'none') + '.',
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
      errors.push({ requestId: req.id, err: err.message });
      logger.error(
        { requestId: req.id, err: err.message },
        'Removal application failed'
      );
    }
  }

  return { applied, errors };
}
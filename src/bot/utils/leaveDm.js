import { EmbedBuilder } from 'discord.js';
import * as settingsService from '../../services/settings.service.js';
import { COLORS } from '../embedBuilders.js';
import logger from '../../config/logger.js';

/**
 * Send a leave-related DM to a user.
 *
 * Contract:
 *   - Respects `settings.notifications.dmAffectedUser`
 *   - Never throws (DM failures are logged and swallowed)
 *   - Uses Discord's locale-aware timestamps
 *
 * @param {Client} client       Discord client
 * @param {object} leave        Leave document (with discordId, startAt, endAt, reason)
 * @param {object} opts
 * @param {string} opts.title   Embed title
 * @param {number} opts.color   Embed color from COLORS
 * @param {string} [opts.actorId]     Discord ID of the person who took action
 * @param {string} [opts.actorLabel]  Label for the actor field (default "Reviewed By")
 * @param {string} [opts.reason]      Optional reason text
 * @param {string} [opts.extraLine]   Optional description text
 * @param {Array}  [opts.extraFields] Optional additional fields
 */
export async function dmLeaveUser(client, leave, {
  title,
  color,
  actorId = null,
  actorLabel = 'Reviewed By',
  reason = null,
  extraLine = null,
  extraFields = [],
} = {}) {
  try {
    const settings = await settingsService.getSettings();
    const dmEnabled = settings?.notifications?.dmAffectedUser ?? true;
    if (!dmEnabled) {
      logger.debug('Leave DM skipped: notifications.dmAffectedUser is false');
      return;
    }

    const discordId = leave?.discordId;
    if (!discordId) {
      logger.debug('Leave DM skipped: no discordId on leave');
      return;
    }

    const user = await client.users.fetch(discordId).catch((err) => {
      logger.debug({ discordId, err: err.message }, 'Could not fetch leave target');
      return null;
    });
    if (!user) {
      logger.warn({ discordId }, 'Could not fetch user for leave DM');
      return;
    }

    const startTs = Math.floor(new Date(leave.startAt).getTime() / 1000);
    const endTs = Math.floor(new Date(leave.endAt).getTime() / 1000);

    const fields = [
      { name: 'Period', value: '<t:' + startTs + ':d> → <t:' + endTs + ':d>', inline: false },
      { name: 'Requested Reason', value: (leave.reason || '—').slice(0, 1000), inline: false },
    ];

    if (actorId) {
      fields.push({ name: actorLabel, value: '<@' + actorId + '>', inline: true });
    }

    if (reason && reason !== leave.reason) {
      fields.push({ name: 'Reviewer Reason', value: reason.slice(0, 1000), inline: false });
    }

    for (const f of extraFields) {
      fields.push(f);
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .addFields(fields)
      .setTimestamp(new Date());

    if (extraLine) embed.setDescription(extraLine);

    await user.send({ embeds: [embed] });
    logger.info(
      { discordId, title, leaveId: String(leave._id) },
      'Leave DM sent'
    );
  } catch (err) {
    logger.warn(
      { err: err.message, discordId: leave?.discordId },
      'Could not DM leave outcome (user may have DMs closed)'
    );
  }
}
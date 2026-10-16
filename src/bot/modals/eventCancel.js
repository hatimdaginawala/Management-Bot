import { MessageFlags, EmbedBuilder } from 'discord.js';
import * as eventService from '../../services/event.service.js';
import * as permissionService from '../../services/permission.service.js';
import { successEmbed, errorEmbed, COLORS } from '../embedBuilders.js';
import { AuthorizationError } from '../../utils/errors.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import logger from '../../config/logger.js';

export const customId = 'modal:event-cancel:*';
export const meta = {};

export async function execute(interaction) {
  const eventId = extractEventId(interaction.customId);
  if (!eventId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Error', description: 'Malformed interaction.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'events.cancel');
  if (!ok) throw new AuthorizationError('You do not have permission to cancel events.');

  const reasonRaw = interaction.fields.getTextInputValue('reason') || '';
  const reason = reasonRaw.trim() || null;

  const event = await eventService.cancelEvent(interaction.user.id, eventId, {
    reason,
    client: interaction.client,
  });

  try {
    const originalEmbed = interaction.message?.embeds?.[0];
    if (originalEmbed) {
      const updated = EmbedBuilder.from(originalEmbed).setColor(0x99aab5).setTitle('Event Cancelled');
      if (reason) updated.addFields({ name: 'Cancellation Reason', value: reason });
      await interaction.message.edit({ embeds: [updated], components: [] });
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Could not edit approval message on cancel');
  }

  const ts = Math.floor(new Date(event.created_at).getTime() / 1000);

  return interaction.reply({
    embeds: [successEmbed({
      title: 'Event Cancelled',
      description: 'Cancelled **' + event.event_type_key + '** hosted by <@' + event.host_discord_id + '> (logged <t:' + ts + ':R>).',
      fields: reason ? [{ name: 'Reason', value: reason, inline: false }] : [],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

function extractEventId(customId) {
  const m = /^modal:event-cancel:(\d+)$/.exec(customId);
  return m ? m[1] : null;
}
import { MessageFlags, EmbedBuilder } from 'discord.js';
import * as eventService from '../../services/event.service.js';
import * as permissionService from '../../services/permission.service.js';
import { successEmbed, errorEmbed, COLORS } from '../embedBuilders.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import * as userRepo from '../../db/repositories/user.repository.js';

export const customId = 'modal:event-reject:*';
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
  const ok = await permissionService.hasPermission(user.id, 'events.reject');
  if (!ok) throw new AuthorizationError('You do not have permission to reject events.');

  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (reason.length < 3) throw new ValidationError('Reason must be at least 3 characters.');

  const event = await eventService.rejectEvent(interaction.user.id, eventId, {
    reason,
    client: interaction.client,
  });

  try {
    const originalEmbed = interaction.message?.embeds?.[0];
    if (originalEmbed) {
      const updated = EmbedBuilder.from(originalEmbed)
        .setColor(COLORS.ERROR)
        .setTitle('Event Rejected')
        .addFields({ name: 'Rejection Reason', value: reason });
      await interaction.message.edit({ embeds: [updated], components: [] });
    }
  } catch {}

  const ts = Math.floor(new Date(event.created_at).getTime() / 1000);

  return interaction.reply({
    embeds: [successEmbed({
      title: 'Event Rejected',
      description: 'Rejected **' + event.event_type_key + '** hosted by <@' + event.host_discord_id + '> (logged <t:' + ts + ':R>).',
      fields: [{ name: 'Reason', value: reason, inline: false }],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

function extractEventId(customId) {
  const m = /^modal:event-reject:(\d+)$/.exec(customId);
  return m ? m[1] : null;
}
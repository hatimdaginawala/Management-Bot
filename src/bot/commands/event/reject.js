import { MessageFlags } from 'discord.js';
import * as eventService from '../../../services/event.service.js';
import { infoEmbed } from '../../embedBuilders.js';
import { showEventPicker } from '../../components/eventPicker.js';
import { assertPermission } from './approve.js';

export async function handleReject(interaction) {
  await assertPermission(interaction, 'events.reject');

  const result = await eventService.listEvents({
    status: 'PENDING',
    page: 1,
    pageSize: 25,
  });

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Pending Events',
        description: 'There are no events waiting for review.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  return showEventPicker(interaction, {
    events: result.items,
    action: 'reject',
    title: 'Reject Event',
    description: 'Select the pending event you want to reject.',
  });
}
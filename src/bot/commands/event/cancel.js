import { MessageFlags } from 'discord.js';
import * as eventService from '../../../services/event.service.js';
import { infoEmbed } from '../../embedBuilders.js';
import { showEventPicker } from '../../components/eventPicker.js';
import { assertPermission } from './approve.js';

export async function handleCancel(interaction) {
  await assertPermission(interaction, 'events.cancel');

  const result = await eventService.listEvents({
    status: 'APPROVED',
    page: 1,
    pageSize: 25,
  });

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Approved Events',
        description: 'There are no approved events to cancel.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  return showEventPicker(interaction, {
    events: result.items,
    action: 'cancel',
    title: 'Cancel Event',
    description: 'Select the approved event you want to cancel.',
  });
}
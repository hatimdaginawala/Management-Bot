import { MessageFlags } from 'discord.js';
import * as eventService from '../../../services/event.service.js';
import { infoEmbed } from '../../embedBuilders.js';
import { showEventPicker, formatEventSummary } from '../../components/eventPicker.js';
import { assertPermission } from './approve.js';

export async function handleView(interaction) {
  await assertPermission(interaction, 'events.view');

  const result = await eventService.listEvents({
    status: 'ANY',
    page: 1,
    pageSize: 25,
  });

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Events',
        description: 'There are no events to view.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  // If only one event exists, skip the picker.
  if (result.total === 1) {
    const event = result.items[0];
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Event Details',
        description: formatEventSummary(event),
        fields: [
          { name: 'Proof', value: event.proofUrl, inline: false },
          ...(event.notes ? [{ name: 'Notes', value: event.notes, inline: false }] : []),
        ],
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  return showEventPicker(interaction, {
    events: result.items,
    action: 'view',
    title: 'View Event',
    description: 'Select the event you want to view.',
  });
}
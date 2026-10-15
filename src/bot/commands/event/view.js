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
    const fields = [
      { name: 'Status', value: '`' + event.status + '`', inline: true },
      { name: 'Type', value: '`' + event.event_type_key + '`', inline: true },
      { name: 'Host', value: '<@' + event.host_discord_id + '>', inline: true },
      { name: 'Attendees', value: String((event.attendeeEntries || []).length), inline: true },
      { name: 'Proof', value: '<' + event.proof_url + '>', inline: false },
    ];
    if (event.notes) fields.push({ name: 'Notes', value: event.notes, inline: false });

    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Event Details',
        description: formatEventSummary(event),
        fields,
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
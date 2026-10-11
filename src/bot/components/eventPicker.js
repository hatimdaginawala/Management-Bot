import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { formatRelative, truncatePlain } from '../utils/format.js';

/**
 * Show an event picker to the user.
 *
 * All labels and descriptions are plain text — Discord does NOT render
 * markdown or <t:...> in select option fields.
 */
export async function showEventPicker(interaction, {
  events,
  action,
  title,
  description,
}) {
  const options = events.slice(0, 25).map((e) => {
    const statusEmoji = {
      PENDING: '🟡',
      APPROVED: '🟢',
      REJECTED: '🔴',
      CANCELLED: '⚫',
    }[e.status] || '⚪';

    const hostName = e.host?.discordUsername || 'unknown host';
    const loggedAgo = formatRelative(e.createdAt);

    // Label: "🟡 patrol — 3 attendees"
    const label = truncatePlain(
      statusEmoji + ' ' + e.eventTypeKey + ' — ' + e.attendeeEntries.length + ' attendees',
      100
    );

    // Description: "by @host · logged 2 hours ago · APPROVED"
    const description = truncatePlain(
      'by @' + hostName + ' · logged ' + loggedAgo + ' · ' + e.status,
      100
    );

    return { label, description, value: String(e._id) };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('event-picker:' + action)
    .setPlaceholder('Select an event')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  const payload = {
    embeds: [{
      title: title || 'Select Event',
      description: description || 'Choose the event you want to act on.',
      color: 0x5865f2,
    }],
    components: [row],
    flags: MessageFlags.Ephemeral,
  };

  if (interaction.deferred && !interaction.replied) {
    return interaction.editReply(payload);
  }
  if (interaction.replied) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

/**
 * Format a single-event confirmation embed. Used by all handlers that
 * act on a picked event.
 */
export function formatEventSummary(event) {
  const ts = Math.floor(new Date(event.createdAt).getTime() / 1000);
  return [
    '**' + event.eventTypeKey + '**',
    'Host: <@' + event.host.discordId + '>',
    'Created: <t:' + ts + ':R>',
    'Attendees: ' + event.attendeeEntries.length,
    'Status: `' + event.status + '`',
  ].join('\n');
}
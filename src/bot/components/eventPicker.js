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

    const hostName = e.host_discord_username || 'unknown host';
    const loggedAgo = formatRelative(e.created_at);
    const attendeeCount = (e.attendeeEntries || []).length;

    const label = truncatePlain(
      statusEmoji + ' ' + e.event_type_key + ' — ' + attendeeCount + ' attendees',
      100
    );

const description = truncatePlain(
  'by @' + hostName
    + (e.cohost_discord_id ? ' + cohost' : '')
    + ' · logged ' + loggedAgo + ' · ' + e.status,
  100
);

    return { label, description, value: String(e.id) };
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
  const ts = Math.floor(new Date(event.created_at).getTime() / 1000);
  const attendeeCount = (event.attendeeEntries || []).length;

  const lines = [
    '**' + event.event_type_key + '**',
    'Host: <@' + event.host_discord_id + '>',
  ];

  if (event.cohost_discord_id) {
    lines.push('Co-host: <@' + event.cohost_discord_id + '>');
  }

  lines.push(
    'Created: <t:' + ts + ':R>',
    'Attendees: ' + attendeeCount,
    'Status: `' + event.status + '`'
  );

  return lines.join('\n');
}
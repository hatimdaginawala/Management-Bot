import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import * as eventService from '../../services/event.service.js';
import { formatRelative, truncatePlain } from '../utils/format.js';

export const customId = ['attendance:add:user', 'attendance:remove:user'];
export const meta = {};

export async function execute(interaction) {
  const isAdd = interaction.customId === 'attendance:add:user';
  const kind = isAdd ? 'attendance:add' : 'attendance:remove';

  const selectedUserId = interaction.values[0];

  sessions.updateSession(kind, interaction.user.id, {
    userId: selectedUserId,
    step: 'event',
  });

  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await eventService.listEvents({
    status: 'APPROVED',
    from,
    page: 1,
    pageSize: 25,
  });

  if (result.items.length === 0) {
    sessions.clearSession(kind, interaction.user.id);
    return interaction.update({
      embeds: [infoEmbed({
        title: 'No Events Available',
        description:
          'No approved events were found in the last 30 days. ' +
          'Log an event first with `/event create`.',
      })],
      components: [],
    });
  }

  // Build plain-text descriptions — no <t:...> or IDs.
  const options = result.items.map((e) => {
    const hostName = e.host.discordUsername || 'unknown host';
    const loggedAgo = formatRelative(e.createdAt);
    const shortType = e.eventTypeKey;

    // Label: "patrol — 3 attendees"
    const label = truncatePlain(shortType + ' — ' + e.attendeeEntries.length + ' attendees', 100);

    // Description: "by @host · logged 2 hours ago"
    const description = truncatePlain('by @' + hostName + ' · logged ' + loggedAgo, 100);

    return { label, description, value: String(e._id) };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(isAdd ? 'attendance:add:event' : 'attendance:remove:event')
    .setPlaceholder('Select the event')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.update({
    embeds: [infoEmbed({
      title: (isAdd ? 'Add' : 'Remove') + ' Attendance — Step 2 of 3',
      description: 'Selected user: <@' + selectedUserId + '>\n\nNow pick the event.',
    })],
    components: [row],
  });
}
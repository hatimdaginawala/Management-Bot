import { MessageFlags } from 'discord.js';
import * as eventService from '../../../services/event.service.js';
import { infoEmbed } from '../../embedBuilders.js';
import { paginate } from '../../components/pagination.js';

export async function handleList(interaction) {
  const status = interaction.options.getString('status') || 'ANY';
  const hostUser = interaction.options.getUser('host');
  const type = interaction.options.getString('type');
  const startPage = interaction.options.getInteger('page') || 1;

  const filters = {
    status,
    hostDiscordId: hostUser ? hostUser.id : undefined,
    eventTypeKey: type || undefined,
    page: startPage,
    pageSize: 10,
  };

  const result = await eventService.listEvents(filters);

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'No Events', description: 'No events match those filters.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await paginate(interaction, {
    totalPages: result.totalPages,
    renderPage: async (page) => {
      const pageResult = await eventService.listEvents({ ...filters, page });
      const lines = pageResult.items.map((e) => {
        const emoji = { PENDING: 'ðŸŸ¡', APPROVED: 'ðŸŸ¢', REJECTED: 'ðŸ”´', CANCELLED: 'âš«' }[e.status] || 'âšª';
        const ts = Math.floor(new Date(e.createdAt).getTime() / 1000);
        return emoji + ' `' + e._id + '` â€” ' + e.eventTypeKey + ' â€” <@' + e.host.discordId + '> â€” <t:' + ts + ':R>';
      });
      return infoEmbed({
        title: 'Events (' + pageResult.total + ' total)',
        description: lines.join('\n'),
      });
    },
  });
}
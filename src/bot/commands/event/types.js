import { MessageFlags } from 'discord.js';
import * as eventTypeService from '../../../services/eventType.service.js';
import { infoEmbed } from '../../embedBuilders.js';
import { assertPermission } from './approve.js';

export async function handleTypes(interaction) {
  await assertPermission(interaction, 'events.view');

  const types = await eventTypeService.listEventTypes({ includeInactive: false });

  const lines = types.map((t) => {
    const desc = t.description || 'no description';
    return '**' + t.name + '** (`' + t.key + '`) - ' + desc;
  });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Available Event Types',
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}
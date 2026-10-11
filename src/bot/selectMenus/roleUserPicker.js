import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import * as roleService from '../../services/role.service.js';
import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';

export const customId = ['role:assign:user', 'role:remove:user'];
export const meta = {};

export async function execute(interaction) {
  const kind = interaction.customId.split(':')[1]; // assign | remove
  const userId = interaction.values[0];

  sessions.updateSession('role:' + kind, interaction.user.id, { userId });

  const roles = await roleService.listRoles({ includeInactive: false });
  const options = roles.slice(0, 25).map((r) => ({
    label: r.name.slice(0, 100),
    description: ('key: ' + r.key + ' | priority ' + r.priority).slice(0, 100),
    value: r.key,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId('role:' + kind + ':role')
    .setPlaceholder('Select a role')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.update({
    embeds: [infoEmbed({
      title: (kind === 'assign' ? 'Assign' : 'Remove') + ' Role — Step 2 of 2',
      description: 'Selected user: <@' + userId + '>\n\nNow pick the role.',
    })],
    components: [row],
  });
}
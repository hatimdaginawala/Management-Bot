import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { Permission } from '../../models/index.js';
import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';

export const customId = 'role-flow:category';
export const meta = {};

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const category = interaction.values[0];

  const flowKind = sessions.getSession('role:create-flow', discordId)
    ? 'role:create-flow'
    : sessions.getSession('role:edit-flow', discordId)
      ? 'role:edit-flow'
      : null;

  if (!flowKind) {
    return interaction.update({
      embeds: [infoEmbed({
        title: 'Session Expired',
        description: 'Please run the command again.',
      })],
      components: [],
    });
  }

  const session = sessions.getSession(flowKind, discordId);
  const permsInCategory = await Permission.find({ category })
    .sort({ key: 1 })
    .lean();

  if (permsInCategory.length === 0) {
    return interaction.update({
      embeds: [infoEmbed({
        title: 'No Permissions',
        description: 'No permissions in that category.',
      })],
      components: [],
    });
  }

  // Show the category's permissions, pre-selecting ones already chosen.
  const already = new Set(session.permissions);
  const options = permsInCategory.slice(0, 25).map((p) => ({
    label: p.key.slice(0, 100),
    description: (p.label || '').slice(0, 100),
    value: p.key,
    default: already.has(p.key),
  }));

  const permMenu = new StringSelectMenuBuilder()
    .setCustomId('role-flow:permissions:' + category)
    .setPlaceholder('Select permissions in "' + category + '"')
    .setMinValues(0)
    .setMaxValues(Math.min(options.length, 25))
    .addOptions(options);

  const backButton = new ButtonBuilder()
    .setCustomId('role-flow:back')
    .setLabel('Back to Categories')
    .setStyle(ButtonStyle.Secondary);

  const clearCategoryButton = new ButtonBuilder()
    .setCustomId('role-flow:clear-category:' + category)
    .setLabel('Clear "' + category + '"')
    .setStyle(ButtonStyle.Danger);

  const row1 = new ActionRowBuilder().addComponents(permMenu);
  const row2 = new ActionRowBuilder().addComponents(backButton, clearCategoryButton);

  // Note: submit happens when the user opens the menu and clicks outside / hits enter.
  // We prompt them to "Select all that apply, then click Back to Categories".

  return interaction.update({
    embeds: [infoEmbed({
      title: 'Category: ' + category,
      description:
        'Select the permissions you want for this category, then click **Back to Categories**.\n' +
        'Currently selected overall: **' + session.permissions.length + '**',
    })],
    components: [row1, row2],
  });
}
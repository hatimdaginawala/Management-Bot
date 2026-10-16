// src/bot/commands/help.js

import {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { infoEmbed, errorEmbed } from '../embedBuilders.js';
import { CATALOG } from '../menus/catalog.js';
import { APP_NAME, APP_VERSION } from '../../config/constants.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Browse available commands.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  // Defer — we're about to build a big embed with N modules.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const visible = visibleModulesForUser(ctx.permissions);

  if (visible.length === 0) {
    return interaction.editReply({
      embeds: [errorEmbed({
        title: 'No Commands Available',
        description: 'You do not have permission to use any commands.',
      })],
    });
  }

  const fields = visible.map((v) => ({
    name: v.group.emoji + ' ' + v.group.label + ' (`/' + v.key + '`)',
    value: v.group.description + '\n_' + v.allowed.length + ' action(s) available_',
    inline: false,
  }));

  const embed = infoEmbed({
    title: APP_NAME + ' — Command Browser',
    description:
      'Version **' + APP_VERSION + '**\n\n' +
      'Pick a module below to see its actions. Only modules you can act on are shown.',
    fields: fields.slice(0, 25),
  });

  const options = visible.slice(0, 25).map((v) => ({
    label: (v.group.emoji + ' ' + v.group.label).slice(0, 100),
    description: v.group.description.slice(0, 100),
    value: v.key,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId('help:module')
    .setPlaceholder('Pick a module')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return interaction.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

function visibleModulesForUser(permissions) {
  const out = [];
  for (const [key, group] of Object.entries(CATALOG)) {
    const allowed = group.actions.filter(
      (a) => !a.permission || permissions.has(a.permission)
    );
    if (allowed.length > 0) out.push({ key, group, allowed });
  }
  return out;
}
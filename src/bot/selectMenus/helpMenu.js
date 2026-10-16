// src/bot/selectMenus/helpMenu.js

import { MessageFlags } from 'discord.js';
import { CATALOG } from '../menus/catalog.js';
import { filterActionsByPermission, renderMenu } from '../menus/render.js';
import { errorEmbed } from '../embedBuilders.js';

/**
 * Handles the /help module picker.
 *
 * customId: `help:module`
 * On pick:  route to the module's menu — the same path `/event` uses.
 */
export const customId = 'help:module';
export const meta = {};

export async function execute(interaction, ctx) {
  const moduleKey = interaction.values[0];
  const group = CATALOG[moduleKey];

  if (!group) {
    return interaction.update({
      embeds: [errorEmbed({ title: 'Unknown Module', description: 'That module does not exist.' })],
      components: [],
    });
  }

  const allowed = await filterActionsByPermission(ctx.user.id, group.actions);
  if (allowed.length === 0) {
    return interaction.update({
      embeds: [
        errorEmbed({
          title: 'No Actions Available',
          description: 'You do not have access to any actions in this module.',
        }),
      ],
      components: [],
    });
  }

  // renderMenu handles update vs reply correctly — it uses editReply when
  // the interaction was deferred, followUp when replied, reply otherwise.
  // For a select interaction, `interaction.update` is correct. We call
  // renderMenu with the same interaction; it will detect `replied`.
  return renderMenu(interaction, moduleKey, group, allowed);
}
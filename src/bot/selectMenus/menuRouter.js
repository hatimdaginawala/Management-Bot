// src/bot/selectMenus/menuRouter.js

import { MessageFlags } from 'discord.js';
import { CATALOG, getAction } from '../menus/catalog.js';
import { filterActionsByPermission, renderMenu } from '../menus/render.js';
import { dispatch } from '../menus/dispatch.js';
import { errorEmbed } from '../embedBuilders.js';

/**
 * CustomId shapes:
 *   menu:<module>          → open a module's menu (handled by slash commands)
 *   menu-pick:<module>     → an action was selected from that module's menu
 *   help:module            → an action was selected from the /help browser
 */
export const customId = ['menu:*', 'menu-pick:*'];
export const meta = {};

export async function execute(interaction, ctx) {
  if (interaction.customId.startsWith('menu-pick:')) {
    return handlePick(interaction, ctx);
  }
  return handleOpen(interaction, ctx);
}

async function handleOpen(interaction, ctx) {
  const moduleKey = interaction.customId.split(':')[1];
  const group = CATALOG[moduleKey];
  if (!group) return ephemeralError(interaction, 'Unknown module.');

  const allowed = await filterActionsByPermission(ctx.user.id, group.actions, ctx.permissions);
  if (allowed.length === 0) {
    return ephemeralError(interaction, 'You do not have access to any actions here.');
  }
  return renderMenu(interaction, moduleKey, group, allowed);
}

async function handlePick(interaction, ctx) {
  const moduleKey = interaction.customId.split(':')[1];
  const actionKey = interaction.values?.[0];   // <- the picked action lives HERE

  if (!moduleKey || !actionKey) {
    return ephemeralError(interaction, 'Malformed interaction.');
  }

  const action = getAction(moduleKey, actionKey);
  if (!action) return ephemeralError(interaction, 'Unknown action.');

  if (action.permission && !ctx.permissions.has(action.permission)) {
    return ephemeralError(interaction, 'You no longer have permission for that action.');
  }

  return dispatch(interaction, action, ctx);
}

async function ephemeralError(interaction, message) {
  const payload = {
    embeds: [errorEmbed({ title: 'Error', description: message })],
    flags: MessageFlags.Ephemeral,
  };
  try {
    if (interaction.deferred && !interaction.replied) return interaction.editReply(payload);
    if (interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
  } catch {
    return null;
  }
}
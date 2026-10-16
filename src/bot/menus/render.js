// src/bot/menus/render.js

import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { infoEmbed, errorEmbed } from '../embedBuilders.js';
import * as permissionService from '../../services/permission.service.js';
import * as sessions from '../sessions.js';
import { CATALOG } from './catalog.js';

export async function filterActionsByPermission(userId, actions, permissions = null) {
  const set = permissions ?? (await permissionService.getEffectivePermissions(userId));
  const allowed = [];
  for (const action of actions) {
    if (!action.permission) {
      allowed.push(action);
      continue;
    }
    if (set.has(action.permission)) allowed.push(action);
  }
  return allowed;
}

export async function openMenuForModule(interaction, ctx, moduleKey) {
  const group = CATALOG[moduleKey];
  if (!group) {
    return replyOrUpdate(interaction, {
      embeds: [errorEmbed({
        title: 'Unknown Module',
        description: 'Module "' + moduleKey + '" is not registered.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.isChatInputCommand?.() && !interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {
      return null;
    }
  }

  const allowed = await filterActionsByPermission(ctx.user.id, group.actions, ctx.permissions);
  return renderMenu(interaction, moduleKey, group, allowed);
}

export async function renderMenu(interaction, moduleKey, group, actions) {
  if (!actions || actions.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [errorEmbed({
        title: 'No Actions Available',
        description: 'You do not have permission to perform any actions here.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  sessions.startSession('menu', interaction.user.id, {
    module: moduleKey,
    actions: actions.map((a) => a.key),
  });

  const options = actions.slice(0, 25).map((a) => ({
    label: String(a.label).slice(0, 100),
    description: String(a.description ?? '').slice(0, 100),
    value: a.key,
  }));

  // The customId for the *menu* itself is fixed per-module.
  // When the user picks an option, the value chosen (a.key) is delivered
  // as interaction.values[0] — NOT baked into the customId.
  const menu = new StringSelectMenuBuilder()
    .setCustomId('menu-pick:' + moduleKey)
    .setPlaceholder('Pick an action')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  const embed = infoEmbed({
    title: (group.emoji ? group.emoji + ' ' : '') + group.label,
    description: group.description + '\n\nPick an action from the menu below.',
  });

  return replyOrUpdate(interaction, {
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

export async function replyOrUpdate(interaction, payload) {
  try {
    if (
      (interaction.isStringSelectMenu?.() ||
        interaction.isButton?.() ||
        interaction.isUserSelectMenu?.() ||
        interaction.isRoleSelectMenu?.() ||
        interaction.isChannelSelectMenu?.() ||
        interaction.isMentionableSelectMenu?.()) &&
      !interaction.deferred &&
      !interaction.replied
    ) {
      return await interaction.update(payload);
    }
    if (interaction.deferred && !interaction.replied) {
      return await interaction.editReply(payload);
    }
    if (interaction.replied) {
      return await interaction.followUp(payload);
    }
    return await interaction.reply(payload);
  } catch {
    return null;
  }
}
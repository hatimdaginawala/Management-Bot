// src/bot/selectMenus/rolePermissionPicker.js

import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { renderCategoryPicker } from '../modals/roleCreate.js';

export const customId = 'role-flow:permissions:*';
export const meta = {};

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const parts = interaction.customId.split(':');
  const category = parts[2];

  const flowKind = sessions.getSession('role:create-flow', discordId)
    ? 'role:create-flow'
    : sessions.getSession('role:edit-flow', discordId)
      ? 'role:edit-flow'
      : null;

  if (!flowKind) {
    return interaction.update({
      embeds: [infoEmbed({ title: 'Session Expired', description: 'Please run the command again.' })],
      components: [],
    });
  }

  const session = sessions.getSession(flowKind, discordId);

  // interaction.values contains the FULL list of selections for this category.
  // We replace that category's selections in the session with the new list.
  const newCategorySelection = interaction.values || [];

  const otherCategoryPerms = session.permissions.filter((p) => {
    return !p.startsWith(category + '.') && !p.startsWith(category + '.*');
  });

  const merged = [...otherCategoryPerms, ...newCategorySelection];
  sessions.updateSession(flowKind, discordId, { permissions: merged });

  return renderCategoryPicker(interaction, discordId, { flowKind });
}
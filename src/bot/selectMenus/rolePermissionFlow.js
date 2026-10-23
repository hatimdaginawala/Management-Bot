// src/bot/selectMenus/rolePermissionFlow.js

import {
  MessageFlags,
} from 'discord.js';
import * as roleService from '../../services/role.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { successEmbed, infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { renderCategoryPicker } from '../modals/roleCreate.js';

export const customId = [
  'role-flow:done',
  'role-flow:back',
  'role-flow:clear-all',
  'role-flow:clear-category:*',
];
export const meta = {};

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const action = interaction.customId;

  const actor = await userRepo.findByDiscordId(discordId);
  if (!actor) throw new AuthorizationError('You do not have permission.');

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

  if (action === 'role-flow:back') {
    return renderCategoryPicker(interaction, discordId, { flowKind });
  }

  if (action === 'role-flow:clear-all') {
    sessions.updateSession(flowKind, discordId, { permissions: [] });
    return renderCategoryPicker(interaction, discordId, { flowKind });
  }

  if (action.startsWith('role-flow:clear-category:')) {
    const category = action.split(':')[2];
    const kept = session.permissions.filter(
      (p) => !p.startsWith(category + '.') && !p.startsWith(category + '.*')
    );
    sessions.updateSession(flowKind, discordId, { permissions: kept });
    return renderCategoryPicker(interaction, discordId, { flowKind });
  }

  if (action === 'role-flow:done') {
    const permissionKey = flowKind === 'role:create-flow' ? 'roles.create' : 'roles.edit';
    const ok = await permissionService.hasPermission(actor.id, permissionKey);
    if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');

    await interaction.deferUpdate();

    try {
      let role;
      if (flowKind === 'role:create-flow') {
        role = await roleService.createRole(interaction.user.id, {
          key: session.key,
          name: session.name,
          priority: session.priority,
          quotaCategory: session.quotaCategory,
          permissions: session.permissions,
        });
        sessions.clearSession(flowKind, discordId);
        return interaction.editReply({
          embeds: [successEmbed({
            title: 'Role Created',
            description: 'Role `' + role.key + '` has been created with **' + role.permissions.length + '** permission(s).',
            fields: [
              { name: 'Name', value: role.name, inline: true },
              { name: 'Priority', value: String(role.priority), inline: true },
              { name: 'Quota Category', value: '`' + role.quota_category + '`', inline: true },
            ],
          })],
          components: [],
        });
      } else {
        role = await roleService.editRole(interaction.user.id, session.key, {
          name: session.name,
          description: session.description,
          priority: session.priority,
          quotaCategory: session.quotaCategory,
          permissions: session.permissions,
        });
        sessions.clearSession(flowKind, discordId);
        return interaction.editReply({
          embeds: [successEmbed({
            title: 'Role Updated',
            description: 'Role `' + role.key + '` has been updated with **' + role.permissions.length + '** permission(s).',
          })],
          components: [],
        });
      }
    } catch (err) {
      return interaction.editReply({
        embeds: [infoEmbed({
          title: 'Role Save Failed',
          description: err.isOperational ? err.message : 'An unexpected error occurred.',
        })],
        components: [],
      });
    }
  }
}
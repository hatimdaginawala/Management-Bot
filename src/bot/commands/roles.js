// src/bot/commands/roles.js

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as roleService from '../../services/role.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import * as roleRepo from '../../db/repositories/role.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { truncatePlain } from '../utils/format.js';
import { openMenuForModule, replyOrUpdate } from '../menus/render.js';

export const data = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Internal role management.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  return openMenuForModule(interaction, ctx, 'roles');
}

async function handleList(interaction, ctx) {
  await assertPermission(interaction, 'roles.view');
  const roles = await roleRepo.list({ includeInactive: false });

  if (roles.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Roles', description: 'No active roles are configured.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = roles.map((r) => {
    const tag = r.is_permanent ? ' 🔒' : '';
    return '• `' + r.key + '` — **' + r.name + '** (priority ' + r.priority + ')' + tag;
  });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Roles (' + roles.length + ')', description: lines.join('\n') })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleView(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'roles.view');
  const key = (params.roleKey ?? interaction.options?.getString?.('role'))?.toLowerCase();

  if (!key) return openRolePicker(interaction, 'role-picker:view', 'View Role');

  const role = await roleService.getRoleByKey(key);
  const flags = [];
  if (role.is_permanent) flags.push('permanent');
  if (!role.is_editable) flags.push('not editable');
  if (!role.is_deletable) flags.push('not deletable');
  if (role.kind === 'SYSTEM') flags.push('system');

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: role.name + ' (`' + role.key + '`)',
      description: role.description || '_No description_',
      fields: [
        { name: 'Priority', value: String(role.priority), inline: true },
        { name: 'Quota Category', value: '`' + role.quota_category + '`', inline: true },
        { name: 'Active', value: role.active ? 'yes' : 'no', inline: true },
        { name: 'Flags', value: flags.length ? flags.join(', ') : '—', inline: false },
        { name: 'Permissions', value: '`' + (role.permissions.length || 0) + ' entries`', inline: true },
      ],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEdit(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'roles.edit');
  const key = (params.roleKey ?? interaction.options?.getString?.('role'))?.toLowerCase();

  if (!key) return openRolePicker(interaction, 'role-picker:edit', 'Edit Role');

  const modal = (await import('../menus/modals.js')).buildModal('modal:role-edit:' + key);
  return interaction.showModal(modal);
}

async function startDeleteFlow(interaction, ctx) {
  await assertPermission(interaction, 'roles.delete');
  const roles = await roleRepo.list({ includeInactive: true });
  const deletable = roles.filter((r) => r.is_deletable);

  if (deletable.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Deletable Roles', description: 'There are no custom roles that can be deleted.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = deletable.slice(0, 25).map((r) => ({
    label: r.name.slice(0, 100),
    description: ('key: ' + r.key + ' | priority ' + r.priority).slice(0, 100),
    value: r.key,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId('role:delete:role')
    .setPlaceholder('Select a role to delete')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Delete Role', description: 'Select the role you want to delete.' })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function startAssignFlow(interaction, ctx) {
  await assertPermission(interaction, 'roles.assign');
  sessions.startSession('role:assign', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('role:assign:user')
    .setPlaceholder('Select the user')
    .setMinValues(1).setMaxValues(1);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Assign Role — Step 1 of 2', description: 'Select the user you want to assign a role to.' })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function startRemoveFlow(interaction, ctx) {
  await assertPermission(interaction, 'roles.assign');
  sessions.startSession('role:remove', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('role:remove:user')
    .setPlaceholder('Select the user')
    .setMinValues(1).setMaxValues(1);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Remove Role — Step 1 of 2', description: 'Select the user you want to remove a role from.' })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePermissions(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'roles.view');
  const key = (params.roleKey ?? interaction.options?.getString?.('role'))?.toLowerCase();

  if (!key) return openRolePicker(interaction, 'role-picker:permissions', 'Role Permissions');

  const role = await roleService.getRoleByKey(key);
  if (role.permissions.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Permissions for ' + role.name, description: '_No permissions assigned._' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const fields = [];
  let current = '';
  for (const p of role.permissions) {
    const next = current ? current + ', `' + p + '`' : '`' + p + '`';
    if (next.length > 1000) {
      fields.push({ name: '​', value: current, inline: false });
      current = '`' + p + '`';
    } else {
      current = next;
    }
  }
  if (current) fields.push({ name: '​', value: current, inline: false });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Permissions for ' + role.name + ' (' + role.permissions.length + ')',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function openRolePicker(interaction, customId, title) {
  const roles = await roleRepo.list({ includeInactive: false });
  if (roles.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Roles', description: 'No roles are configured.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = roles.slice(0, 25).map((r) => ({
    label: truncatePlain(r.name, 100),
    description: truncatePlain('key: ' + r.key + ' · priority ' + r.priority, 100),
    value: r.key,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Pick a role')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title, description: 'Pick a role to continue.' })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function assertPermission(interaction, permissionKey) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission to perform this action.');
  const ok = await permissionService.hasPermission(user.id, permissionKey);
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');
}

export const HANDLERS = {
  list: handleList,
  view: handleView,
  edit: handleEdit,
  delete: startDeleteFlow,
  assign: startAssignFlow,
  remove: startRemoveFlow,
  permissions: handlePermissions,
};
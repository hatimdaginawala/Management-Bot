import {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as roleService from '../../services/role.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User, Role } from '../../models/index.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed, successEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';

export const data = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Internal role management.')
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List all active roles.')
  )
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('View a role in detail.')
      .addStringOption((opt) =>
        opt
          .setName('role')
          .setDescription('Role key')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('create').setDescription('Create a new custom role.')
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Edit an existing role.')
      .addStringOption((opt) =>
        opt
          .setName('role')
          .setDescription('Role key')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('delete').setDescription('Delete a custom role.')
  )
  .addSubcommand((sub) =>
    sub.setName('assign').setDescription('Assign a role to a user.')
  )
  .addSubcommand((sub) =>
    sub.setName('remove').setDescription('Remove a role from a user.')
  )
  .addSubcommand((sub) =>
    sub
      .setName('permissions')
      .setDescription('List the effective permissions of a role.')
      .addStringOption((opt) =>
        opt
          .setName('role')
          .setDescription('Role key')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .toJSON();

export const meta = {};

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const roles = await roleService.listRoles({ includeInactive: false });
  const filtered = roles
    .filter((r) => r.key.includes(focused) || r.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((r) => ({ name: r.key + ' — ' + r.name, value: r.key }));
  await interaction.respond(filtered);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'list':        return handleList(interaction);
    case 'view':        return handleView(interaction);
    case 'create':      return handleCreate(interaction);
    case 'edit':        return handleEdit(interaction);
    case 'delete':      return startDeleteFlow(interaction);
    case 'assign':      return startAssignFlow(interaction);
    case 'remove':      return startRemoveFlow(interaction);
    case 'permissions': return handlePermissions(interaction);
    default:
      throw new Error('Unknown /roles subcommand: ' + sub);
  }
}

// ============================================================
//  list
// ============================================================

async function handleList(interaction) {
  await assertPermission(interaction, 'roles.view');

  const roles = await roleService.listRoles({ includeInactive: false });

  if (roles.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Roles',
        description: 'No active roles are configured.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = roles.map((r) => {
    const tag = r.isPermanent ? ' 🔒' : '';
    return '• `' + r.key + '` — **' + r.name + '** (priority ' + r.priority + ')' + tag;
  });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Roles (' + roles.length + ')',
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  view
// ============================================================

async function handleView(interaction) {
  await assertPermission(interaction, 'roles.view');
  const key = interaction.options.getString('role', true).toLowerCase();

  const role = await roleService.getRoleByKey(key);

  const flags = [];
  if (role.isPermanent) flags.push('permanent');
  if (!role.isEditable) flags.push('not editable');
  if (!role.isDeletable) flags.push('not deletable');
  if (role.kind === 'SYSTEM') flags.push('system');

  return interaction.reply({
    embeds: [infoEmbed({
      title: role.name + ' (`' + role.key + '`)',
      description: role.description || '_No description_',
      fields: [
        { name: 'Priority', value: String(role.priority), inline: true },
        { name: 'Quota Category', value: '`' + role.quotaCategory + '`', inline: true },
        { name: 'Active', value: role.active ? 'yes' : 'no', inline: true },
        { name: 'Flags', value: flags.length ? flags.join(', ') : '—', inline: false },
        { name: 'Permissions', value: '`' + (role.permissions.length || 0) + ' entries`', inline: true },
      ],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  create
// ============================================================

async function handleCreate(interaction) {
  await assertPermission(interaction, 'roles.create');

  const modal = new ModalBuilder()
    .setCustomId('modal:role-create')
    .setTitle('Create Role');

  const keyInput = new TextInputBuilder()
    .setCustomId('key')
    .setLabel('Role key')
    .setPlaceholder('lowercase_snake_case (e.g. event_manager)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(41);

  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Display name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);

  const priorityInput = new TextInputBuilder()
    .setCustomId('priority')
    .setLabel('Priority (0-999)')
    .setPlaceholder('e.g. 20')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3);

  const quotaInput = new TextInputBuilder()
    .setCustomId('quotaCategory')
    .setLabel('Quota category')
    .setPlaceholder('NONE, STAFF, or LOW_RANK')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  modal.addComponents(
    new ActionRowBuilder().addComponents(keyInput),
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(priorityInput),
    new ActionRowBuilder().addComponents(quotaInput)
  );

  return interaction.showModal(modal);
}

// ============================================================
//  edit
// ============================================================

async function handleEdit(interaction) {
  await assertPermission(interaction, 'roles.edit');
  const key = interaction.options.getString('role', true).toLowerCase();

  const modal = new ModalBuilder()
    .setCustomId('modal:role-edit:' + key)
    .setTitle('Edit Role: ' + key.slice(0, 30));

  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Display name (leave blank to keep current)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(80);

  const descInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description (blank to keep current)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  const priorityInput = new TextInputBuilder()
    .setCustomId('priority')
    .setLabel('Priority (blank to keep current)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(3);

  const quotaInput = new TextInputBuilder()
    .setCustomId('quotaCategory')
    .setLabel('Quota category (blank to keep current)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(descInput),
    new ActionRowBuilder().addComponents(priorityInput),
    new ActionRowBuilder().addComponents(quotaInput)
  );

  return interaction.showModal(modal);
}

// ============================================================
//  delete
// ============================================================

async function startDeleteFlow(interaction) {
  await assertPermission(interaction, 'roles.delete');

  const roles = await roleService.listRoles({ includeInactive: true });
  const deletable = roles.filter((r) => r.isDeletable);

  if (deletable.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Deletable Roles',
        description: 'There are no custom roles that can be deleted.',
      })],
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
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Delete Role',
      description: 'Select the role you want to delete.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  assign / remove
// ============================================================

async function startAssignFlow(interaction) {
  await assertPermission(interaction, 'roles.assign');

  sessions.startSession('role:assign', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('role:assign:user')
    .setPlaceholder('Select the user')
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Assign Role — Step 1 of 2',
      description: 'Select the user you want to assign a role to.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function startRemoveFlow(interaction) {
  await assertPermission(interaction, 'roles.assign');

  sessions.startSession('role:remove', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('role:remove:user')
    .setPlaceholder('Select the user')
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Remove Role — Step 1 of 2',
      description: 'Select the user you want to remove a role from.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  permissions
// ============================================================

async function handlePermissions(interaction) {
  await assertPermission(interaction, 'roles.view');
  const key = interaction.options.getString('role', true).toLowerCase();

  const role = await roleService.getRoleByKey(key);

  if (role.permissions.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Permissions for ' + role.name,
        description: '_No permissions assigned._',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Chunk into lines, respecting Discord's 1024-char field limit.
  const permList = role.permissions.map((p) => '`' + p + '`').join(', ');
  const fields = [];
  let current = '';
  for (const chunk of role.permissions) {
    const next = current ? current + ', `' + chunk + '`' : '`' + chunk + '`';
    if (next.length > 1000) {
      fields.push({ name: '​', value: current, inline: false });
      current = '`' + chunk + '`';
    } else {
      current = next;
    }
  }
  if (current) fields.push({ name: '​', value: current, inline: false });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Permissions for ' + role.name + ' (' + role.permissions.length + ')',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  helpers
// ============================================================

async function assertPermission(interaction, permissionKey) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
  const ok = await permissionService.hasPermission(user._id, permissionKey);
  if (!ok) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
}
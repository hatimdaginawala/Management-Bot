import {
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import * as permissionService from '../../services/permission.service.js';
import { Permission } from '../../models/index.js';
import { User } from '../../models/index.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';

export const customId = 'modal:role-create';
export const meta = {};

export async function execute(interaction) {
  const actor = await User.findOne({ discordId: interaction.user.id });
  if (!actor) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(actor._id, 'roles.create');
  if (!ok) throw new AuthorizationError('You do not have permission to create roles.');

  const key = interaction.fields.getTextInputValue('key').trim().toLowerCase();
  const name = interaction.fields.getTextInputValue('name').trim();
  const priorityRaw = interaction.fields.getTextInputValue('priority').trim();
  const quotaRaw = interaction.fields.getTextInputValue('quotaCategory').trim().toUpperCase();

  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) {
    throw new ValidationError('Role key must be lowercase, start with a letter, 2-41 chars (a-z, 0-9, _).');
  }
  const priority = Number.parseInt(priorityRaw, 10);
  if (!Number.isInteger(priority) || priority < 0 || priority > 999) {
    throw new ValidationError('Priority must be an integer between 0 and 999.');
  }
  const quotaCategory = quotaRaw || 'NONE';
  if (!['NONE', 'STAFF', 'LOW_RANK'].includes(quotaCategory)) {
    throw new ValidationError('Quota category must be NONE, STAFF, or LOW_RANK.');
  }

  // Store the pending role data + empty permissions in the session.
  sessions.startSession('role:create-flow', interaction.user.id, {
    key,
    name,
    priority,
    quotaCategory,
    permissions: [],
  });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await renderCategoryPicker(interaction, interaction.user.id);
}

// ============================================================
//  Shared UI renderer — used by both create and edit flows
// ============================================================

export async function renderCategoryPicker(interaction, discordId, { flowKind = 'role:create-flow' } = {}) {
  const session = sessions.getSession(flowKind, discordId);
  if (!session) {
    return sendExpired(interaction);
  }

  const categories = await Permission.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const options = categories.slice(0, 25).map((c) => {
    const selectedInCategory = session.permissions.filter((p) =>
      p.startsWith(c._id + '.') || p === c._id + '.*'
    ).length;
    return {
      label: c._id,
      description: (c.count + ' permissions' + (selectedInCategory ? ' — ' + selectedInCategory + ' selected' : '')).slice(0, 100),
      value: c._id,
    };
  });

  const categoryMenu = new StringSelectMenuBuilder()
    .setCustomId('role-flow:category')
    .setPlaceholder('Pick a category to configure')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const doneButton = new ButtonBuilder()
    .setCustomId('role-flow:done')
    .setLabel('Done' + (session.permissions.length ? ' (' + session.permissions.length + ' selected)' : ''))
    .setStyle(ButtonStyle.Success);

  const clearAllButton = new ButtonBuilder()
    .setCustomId('role-flow:clear-all')
    .setLabel('Clear All')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(session.permissions.length === 0);

  const row1 = new ActionRowBuilder().addComponents(categoryMenu);
  const row2 = new ActionRowBuilder().addComponents(doneButton, clearAllButton);

  const embed = infoEmbed({
    title: flowKind === 'role:create-flow'
      ? 'Create Role — Select Permissions'
      : 'Edit Role — Select Permissions',
    description:
      '**Role:** `' + session.key + '` — ' + session.name + '\n' +
      '**Priority:** ' + session.priority + ' — **Quota:** `' + session.quotaCategory + '`\n\n' +
      'Pick a category to add permissions. ' +
      'You currently have **' + session.permissions.length + '** permission(s) selected. ' +
      'Click **Done** when finished.',
  });

  if (interaction.deferred && !interaction.replied) {
    return interaction.editReply({ embeds: [embed], components: [row1, row2] });
  }
  if (interaction.isStringSelectMenu() || interaction.isButton()) {
    return interaction.update({ embeds: [embed], components: [row1, row2] });
  }
  return interaction.reply({ embeds: [embed], components: [row1, row2], flags: MessageFlags.Ephemeral });
}

async function sendExpired(interaction) {
  const embed = infoEmbed({
    title: 'Session Expired',
    description: 'Please run the command again.',
  });
  if (interaction.deferred || interaction.replied || interaction.isStringSelectMenu()) {
    return interaction.update({ embeds: [embed], components: [] });
  }
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// Re-export so the picker can import it
export { sendExpired };
// src/bot/commands/leave.js

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as leaveService from '../../services/leave.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { formatDateRange, formatRelative, resolveUsernames, truncatePlain } from '../utils/format.js';
import { openMenuForModule, replyOrUpdate } from '../menus/render.js';

export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Leave requests and approvals.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  return openMenuForModule(interaction, ctx, 'leave');
}

async function handleView(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'leave.view');
  const target = params.user ?? interaction.options?.getUser?.('user') ?? interaction.user;

  const result = await leaveService.listLeaves({ discordId: target.id, pageSize: 20 });
  if (result.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({
        title: 'No Leave History',
        description: '<@' + target.id + '> has no leave records.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = result.items.map((l) => {
    const start = Math.floor(new Date(l.start_at).getTime() / 1000);
    const end = Math.floor(new Date(l.end_at).getTime() / 1000);
    const emoji = { PENDING: '🟡', APPROVED: '🟢', REJECTED: '🔴', EXPIRED: '⚫', CANCELLED: '⚪' }[l.status] || '⚪';
    return emoji + ' <t:' + start + ':d> → <t:' + end + ':d> — **' + l.status + '**' +
           (l.reason ? '\n  _' + l.reason + '_' : '');
  });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Leave History for ' + target.username,
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleActive(interaction, ctx) {
  await assertPermission(interaction, 'leave.view');

  const result = await leaveService.listLeaves({ status: 'APPROVED', pageSize: 100 });
  const now = new Date();
  const active = result.items.filter((l) => new Date(l.start_at) <= now && new Date(l.end_at) >= now);

  if (active.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Active Leaves', description: 'No members are currently on approved leave.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = active.map((l) => {
    const end = Math.floor(new Date(l.end_at).getTime() / 1000);
    return '• <@' + l.discord_id + '> — until <t:' + end + ':d> — ' + l.reason;
  });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Active Leaves (' + active.length + ')',
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function startApproveFlow(interaction, ctx) {
  await assertPermission(interaction, 'leave.approve');
  return showLeavePicker(interaction, 'PENDING', 'leave:approve:request', 'Approve Leave');
}

async function startRejectFlow(interaction, ctx) {
  await assertPermission(interaction, 'leave.reject');
  return showLeavePicker(interaction, 'PENDING', 'leave:reject:request', 'Reject Leave');
}

async function startEndFlow(interaction, ctx) {
  await assertPermission(interaction, 'leave.manage');
  return showLeavePicker(interaction, 'APPROVED', 'leave:end:request', 'End Leave');
}

async function showLeavePicker(interaction, status, customId, title) {
  const result = await leaveService.listLeaves({ status, pageSize: 25 });
  if (result.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({
        title: 'No ' + status + ' Leaves',
        description: 'There are no ' + status.toLowerCase() + ' leave requests.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const usernames = await resolveUsernames(interaction.client, result.items.map((l) => l.discord_id));
  const options = result.items.map((l) => {
    const username = usernames.get(l.discord_id) || 'unknown user';
    const period = formatDateRange(l.start_at, l.end_at);
    const submittedAgo = formatRelative(l.created_at);
    const reasonSnippet = truncatePlain(l.reason || 'no reason', 60);
    return {
      label: ('@' + username).slice(0, 100),
      description: truncatePlain(period + ' · submitted ' + submittedAgo + ' · ' + reasonSnippet, 100),
      value: String(l.id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select a leave request')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title,
      description: '**' + result.total + '** ' + status.toLowerCase() + ' request(s). Select one to act on.',
    })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleCancel(interaction, ctx) {
  const result = await leaveService.listLeaves({
    status: 'PENDING',
    discordId: interaction.user.id,
    pageSize: 5,
  });

  if (result.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({
        title: 'No Pending Leave',
        description: 'You do not have a pending leave request to cancel.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (result.total === 1) {
    await leaveService.cancelLeave(interaction.user.id, result.items[0].id, {
      reason: 'Cancelled by requester',
    });
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Leave Cancelled', description: 'Your pending leave request has been cancelled.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = result.items.map((l) => {
    const period = formatDateRange(l.start_at, l.end_at);
    const submittedAgo = formatRelative(l.created_at);
    return {
      label: truncatePlain('Requested ' + submittedAgo, 100),
      description: truncatePlain(period + ' · ' + (l.reason || 'no reason'), 100),
      value: String(l.id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('leave:self:cancel')
    .setPlaceholder('Select a leave to cancel')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Cancel Leave', description: 'Select the pending leave you want to cancel.' })],
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
async function startPermanentLeaveFlow(interaction, ctx) {
  await assertPermission(interaction, 'leave.create');

  const modal = new (await import('discord.js')).ModalBuilder()
    .setCustomId('modal:leave-permanent')
    .setTitle('Request Permanent Leave');

  const reasonInput = new (await import('discord.js')).TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for leaving')
    .setPlaceholder('Why you are leaving the group')
    .setStyle((await import('discord.js')).TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(
    new (await import('discord.js')).ActionRowBuilder().addComponents(reasonInput)
  );

  return interaction.showModal(modal);
}
export const HANDLERS = {
  view: handleView,
  active: handleActive,
  approve: startApproveFlow,
  reject: startRejectFlow,
  end: startEndFlow,
  cancel: handleCancel,
  permanent: startPermanentLeaveFlow,
};
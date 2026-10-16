// src/bot/commands/notice.js

import {
  SlashCommandBuilder,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import * as noticeService from '../../services/notice.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { openMenuForModule, replyOrUpdate } from '../menus/render.js';

export const data = new SlashCommandBuilder()
  .setName('notice')
  .setDescription('Notices and inactivity records.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  return openMenuForModule(interaction, ctx, 'notice');
}

async function startCreateFlow(interaction, ctx) {
  await assertPermission(interaction, 'notice.create');
  sessions.startSession('notice:create', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('notice:create:user')
    .setPlaceholder('Select the user to notify')
    .setMinValues(1).setMaxValues(1);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Create Notice — Step 1 of 2',
      description: 'Select the Discord user you want to create a notice for.',
    })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleView(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'notice.view');
  const target = params.user ?? interaction.options?.getUser?.('user');

  if (!target) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Pick a User', description: 'Select a user to view notices for.' })],
      components: [new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('notice:pick-user:view')
          .setPlaceholder('Select a user')
          .setMinValues(1).setMaxValues(1)
      )],
      flags: MessageFlags.Ephemeral,
    });
  }

  const active = await noticeService.getActiveNoticesForUser(target.id);
  if (active.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Active Notices', description: '<@' + target.id + '> has no active notices.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = active.map((n) => {
    const start = Math.floor(new Date(n.start_at).getTime() / 1000);
    const end = n.end_at ? '<t:' + Math.floor(new Date(n.end_at).getTime() / 1000) + ':d>' : 'open-ended';
    const exempt = n.grants_quota_exemption ? ' — *exempt*' : '';
    return '• `' + n.type + '` — <t:' + start + ':R> until ' + end + exempt + '\n  ' + n.reason;
  });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Active Notices for ' + target.username,
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function startCancelFlow(interaction, ctx) {
  await assertPermission(interaction, 'notice.manage');

  const result = await noticeService.listNotices({ status: 'ACTIVE', pageSize: 25 });
  if (result.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Active Notices', description: 'There are no active notices to cancel.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const { resolveUsernames, formatRelative, truncatePlain } = await import('../utils/format.js');
  const usernames = await resolveUsernames(interaction.client, result.items.map((n) => n.discord_id));

  const options = result.items.map((n) => {
    const username = usernames.get(n.discord_id) || 'unknown user';
    const issuedAgo = formatRelative(n.start_at);
    const exempt = n.grants_quota_exemption ? ' · exempt' : '';
    return {
      label: truncatePlain('@' + username + ' — ' + n.type, 100),
      description: truncatePlain('issued ' + issuedAgo + exempt + ' · ' + (n.reason || 'no reason'), 100),
      value: String(n.id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('notice:cancel:notice')
    .setPlaceholder('Select a notice to cancel')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Cancel Notice',
      description: '**' + result.total + '** active notice(s). Select one to cancel.',
    })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleActive(interaction, ctx) {
  await assertPermission(interaction, 'notice.view');

  const result = await noticeService.listNotices({ status: 'ACTIVE', pageSize: 25 });
  if (result.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Active Notices', description: 'There are no active notices.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = result.items.map((n) => {
    const start = Math.floor(new Date(n.start_at).getTime() / 1000);
    const exempt = n.grants_quota_exemption ? ' 🟢' : '';
    return '• <@' + n.discord_id + '> — `' + n.type + '`' + exempt + ' — <t:' + start + ':R>';
  });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Active Notices (' + result.total + ')',
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function startExtendFlow(interaction, ctx) {
  await assertPermission(interaction, 'notice.view');

  const result = await noticeService.listNotices({
    status: 'ACTIVE',
    discordId: interaction.user.id,
    pageSize: 25,
  });

  if (result.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Active Notices', description: 'You have no active notices to extend.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = result.items.map((n) => {
    const endStr = n.end_at ? new Date(n.end_at).toISOString().slice(0, 10) : 'open-ended';
    return {
      label: ('Notice: ' + n.type).slice(0, 100),
      description: ('Ends ' + endStr + ' — ' + (n.reason || 'no reason')).slice(0, 100),
      value: String(n.id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('notice:extend:notice')
    .setPlaceholder('Select a notice to extend')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Request Notice Extension', description: 'Select the notice you want to extend.' })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleApproveExtension(interaction, ctx) {
  await assertPermission(interaction, 'notice.manage');

  const pending = await noticeService.listPendingExtensions({ limit: 25 });
  if (pending.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Pending Extensions', description: 'There are no pending notice extensions to approve.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = pending.map((n) => {
    const newEnd = new Date(n.pending_extension_new_end_at).toISOString().slice(0, 10);
    const requestedAgo = Math.floor((Date.now() - new Date(n.pending_extension_requested_at).getTime()) / 60000);
    return {
      label: ('@' + (n.discord_id || 'unknown') + ' — ' + n.type).slice(0, 100),
      description: ('New end ' + newEnd + ' — requested ' + requestedAgo + ' min ago').slice(0, 100),
      value: String(n.id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('notice:extension:approve:request')
    .setPlaceholder('Select a pending extension')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Approve Notice Extension',
      description: '**' + pending.length + '** pending request(s). Select one to approve.',
    })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRejectExtension(interaction, ctx) {
  await assertPermission(interaction, 'notice.manage');

  const pending = await noticeService.listPendingExtensions({ limit: 25 });
  if (pending.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Pending Extensions', description: 'There are no pending notice extensions to reject.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = pending.map((n) => {
    const newEnd = new Date(n.pending_extension_new_end_at).toISOString().slice(0, 10);
    return {
      label: ('@' + (n.discord_id || 'unknown') + ' — ' + n.type).slice(0, 100),
      description: ('Requested new end ' + newEnd).slice(0, 100),
      value: String(n.id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('notice:extension:reject:request')
    .setPlaceholder('Select a pending extension')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Reject Notice Extension',
      description: '**' + pending.length + '** pending request(s). Select one to reject.',
    })],
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
  create: startCreateFlow,
  view: handleView,
  cancel: startCancelFlow,
  active: handleActive,
  extend: startExtendFlow,
  'approve-extension': handleApproveExtension,
  'reject-extension': handleRejectExtension,
};
// src/bot/commands/strike.js

import {
  SlashCommandBuilder,
  UserSelectMenuBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as strikeService from '../../services/strike.service.js';
import * as removalRequestService from '../../services/removalRequest.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import { paginate } from '../components/pagination.js';
import * as sessions from '../sessions.js';
import { resolveUsernames, formatRelative, truncatePlain } from '../utils/format.js';
import { openMenuForModule, replyOrUpdate } from '../menus/render.js';

export const data = new SlashCommandBuilder()
  .setName('strike')
  .setDescription('Strike management, recovery, and removal requests.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  return openMenuForModule(interaction, ctx, 'strike');
}

async function handleView(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'strikes.view');
  const target = params.user ?? interaction.options?.getUser?.('user');

  if (!target) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Pick a User', description: 'Select a user to view strikes for.' })],
      components: [new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('strike:pick-user:view')
          .setPlaceholder('Select a user')
          .setMinValues(1).setMaxValues(1)
      )],
      flags: MessageFlags.Ephemeral,
    });
  }

  const active = await strikeService.getActiveStrikes(target.id);
  if (active.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Active Strikes', description: '<@' + target.id + '> has no active strikes.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = active.map((s) => {
    const ts = Math.floor(new Date(s.issued_at).getTime() / 1000);
    const period = s.quota_period_key ? ' — ' + s.quota_period_key : '';
    return '• `' + s.type + '`' + period + ' — <t:' + ts + ':R> — ' + s.reason;
  });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Active Strikes for ' + target.username,
      description: lines.join('\n'),
      fields: [{ name: 'Total Active', value: String(active.length), inline: true }],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHistory(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'strikes.view');
  const target = params.user ?? interaction.options?.getUser?.('user');
  const limit = params.limit ?? interaction.options?.getInteger?.('limit') ?? 50;

  if (!target) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Pick a User', description: 'Select a user to view strike history for.' })],
      components: [new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('strike:pick-user:history')
          .setPlaceholder('Select a user')
          .setMinValues(1).setMaxValues(1)
      )],
      flags: MessageFlags.Ephemeral,
    });
  }

  const all = await strikeService.getStrikeHistory(target.id, { limit });
  if (all.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Strike History', description: '<@' + target.id + '> has no strike history.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = all.map((s) => {
    const ts = Math.floor(new Date(s.issued_at).getTime() / 1000);
    const emoji = { ACTIVE: '🟡', RECOVERED: '🟢', CANCELLED: '⚫', EXPIRED: '⚪' }[s.status] || '⚪';
    const period = s.quota_period_key ? ' — ' + s.quota_period_key : '';
    return emoji + ' `' + s.type + '`' + period + ' — <t:' + ts + ':R>';
  });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Strike History for ' + target.username,
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function startIssueFlow(interaction, ctx) {
  await assertPermission(interaction, 'strikes.issue');
  sessions.startSession('strike:issue', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('strike:issue:user')
    .setPlaceholder('Select the user to strike')
    .setMinValues(1).setMaxValues(1);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Issue Strike — Step 1 of 2', description: 'Select the Discord user you want to issue a strike to.' })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function startRemoveFlow(interaction, ctx) {
  await assertPermission(interaction, 'strikes.remove');

  const menu = new UserSelectMenuBuilder()
    .setCustomId('strike:remove:user')
    .setPlaceholder('Select the user whose strike you want to remove')
    .setMinValues(1).setMaxValues(1);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Remove Strike — Step 1 of 2', description: 'Select the user.' })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function startRecoverFlow(interaction, ctx) {
  await assertPermission(interaction, 'strikes.remove');

  const menu = new UserSelectMenuBuilder()
    .setCustomId('strike:recover:user')
    .setPlaceholder('Select the user whose strike you want to recover')
    .setMinValues(1).setMaxValues(1);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Recover Strike — Step 1 of 2', description: 'Select the user.' })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePendingRemovals(interaction, ctx) {
  await assertPermission(interaction, 'removal.view');

  const result = await removalRequestService.listPendingRemovals({ page: 1, pageSize: 10 });
  if (result.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Pending Removals', description: 'There are no pending removal requests.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  await paginate(interaction, {
    totalPages: result.totalPages,
    renderPage: async (page) => {
      const pageResult = await removalRequestService.listPendingRemovals({ page, pageSize: 10 });
      const lines = pageResult.items.map((r) => {
        const ts = Math.floor(new Date(r.created_at).getTime() / 1000);
        return '• <@' + r.discord_id + '> — ' + r.reason +
               ' — strikes: ' + r.strike_count + '/' + r.strike_threshold +
               ' — <t:' + ts + ':R>';
      });
      return infoEmbed({
        title: 'Pending Removal Requests (' + pageResult.total + ')',
        description: lines.join('\n'),
      });
    },
  });
}

async function startApproveRemovalFlow(interaction, ctx) {
  await assertPermission(interaction, 'removal.approve');
  return showRemovalPicker(interaction, 'removal:approve:request', 'Approve Removal');
}

async function startDismissRemovalFlow(interaction, ctx) {
  await assertPermission(interaction, 'removal.dismiss');
  return showRemovalPicker(interaction, 'removal:dismiss:request', 'Dismiss Removal');
}

async function showRemovalPicker(interaction, customId, title) {
  const pending = await removalRequestService.listPendingRemovals({ page: 1, pageSize: 25 });
  if (pending.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Pending Removals', description: 'There are no pending removal requests.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const usernames = await resolveUsernames(interaction.client, pending.items.map((r) => r.discord_id));
  const options = pending.items.map((r) => {
    const username = usernames.get(r.discord_id) || 'unknown user';
    const reason = r.description || r.reason || 'no reason';
    const ageAgo = formatRelative(r.created_at);
    return {
      label: truncatePlain('@' + username, 100),
      description: truncatePlain(r.strike_count + '/' + r.strike_threshold + ' strikes · ' + ageAgo + ' · ' + reason, 100),
      value: String(r.id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select a pending removal')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title, description: '**' + pending.total + '** pending removal request(s).' })],
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
  view: handleView,
  history: handleHistory,
  issue: startIssueFlow,
  remove: startRemoveFlow,
  recover: startRecoverFlow,
  'pending-removals': handlePendingRemovals,
  'approve-removal': startApproveRemovalFlow,
  'dismiss-removal': startDismissRemovalFlow,
};
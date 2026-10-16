// src/bot/commands/members.js

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as userService from '../../services/user.service.js';
import * as statisticsService from '../../services/statistics.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import * as roleRepo from '../../db/repositories/role.repository.js';
import * as removalRequestRepo from '../../db/repositories/removalRequest.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import { paginate } from '../components/pagination.js';
import { truncatePlain } from '../utils/format.js';
import { openMenuForModule, replyOrUpdate } from '../menus/render.js';

export const data = new SlashCommandBuilder()
  .setName('members')
  .setDescription('Browse and filter group members.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  return openMenuForModule(interaction, ctx, 'members');
}

async function handleView(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'users.view');
  const target = params.user ?? interaction.options?.getUser?.('user');

  if (!target) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Pick a Member', description: 'Select a member to view.' })],
      components: [new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('member:pick-user:view')
          .setPlaceholder('Select a member')
          .setMinValues(1).setMaxValues(1)
      )],
      flags: MessageFlags.Ephemeral,
    });
  }

  const [profile, stats] = await Promise.all([
    userService.getMemberProfile(target.id),
    statisticsService.userStats(target.id).catch(() => null),
  ]);

  if (!profile) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({
        title: 'Member Not Found',
        description: '<@' + target.id + '> is not registered with the bot.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const u = profile.user;
  const roles = profile.roles.length
    ? profile.roles.map((r) => '`' + r.key + '`').join(', ')
    : '_none_';

  const fields = [
    {
      name: 'Identity',
      value: [
        '**Discord:** <@' + u.discord_id + '>',
        '**Roblox:** ' + (u.roblox_username ? '`' + u.roblox_username + '`' : '_not linked_'),
        '**Status:** `' + u.status + '`',
      ].join('\n'),
      inline: false,
    },
    {
      name: 'Quota',
      value: [
        '**Category:** `' + (u.quota_category || 'NONE') + '`',
        u.quota_exempt
          ? '**Exempt:** ✅ ' + (u.quota_exempt_reason || '')
          : '**Exempt:** ❌',
      ].join('\n'),
      inline: true,
    },
  ];

  if (u.roblox_rank_name) {
    fields.push({
      name: 'Roblox Rank',
      value: '**' + u.roblox_rank_name + '** (value ' + (u.roblox_rank_value ?? '?') + ')',
      inline: true,
    });
  }

  if (stats) {
    fields.push({
      name: 'Activity',
      value: [
        '**Events Hosted:** ' + stats.activity.totalEventsHosted,
        '**Events Attended:** ' + stats.activity.totalEventsAttended,
        '**Rank Changes:** ' + stats.activity.rankChanges,
      ].join('\n'),
      inline: true,
    });
    fields.push({
      name: 'Discipline',
      value: [
        '**Active Strikes:** ' + stats.strikes.active,
        '**Lifetime Strikes:** ' + stats.strikes.lifetime,
        '**Recovered:** ' + stats.strikes.recovered,
      ].join('\n'),
      inline: true,
    });
  }

  fields.push({ name: 'Roles', value: roles, inline: false });

  if (profile.activeLeave) {
    const end = Math.floor(new Date(profile.activeLeave.end_at).getTime() / 1000);
    fields.push({
      name: 'Active Leave',
      value: 'Until <t:' + end + ':d> — ' + profile.activeLeave.reason,
      inline: false,
    });
  }

  if (profile.activeNotices.length > 0) {
    fields.push({
      name: 'Active Notices (' + profile.activeNotices.length + ')',
      value: profile.activeNotices
        .map((n) => '• `' + n.type + '` — ' + n.reason)
        .join('\n')
        .slice(0, 1000),
      inline: false,
    });
  }

  const joinedTs = u.joined_at ? Math.floor(new Date(u.joined_at).getTime() / 1000) : null;

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Member: ' + (u.discord_username || target.username),
      description: joinedTs ? 'Joined <t:' + joinedTs + ':R>' : null,
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleList(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'users.view');
  const status = params.status ?? interaction.options?.getString?.('status') ?? 'ANY';
  const search = params.search ?? interaction.options?.getString?.('search');

  return listWithFilters(interaction, { status, search });
}

async function handleActive(interaction, ctx) {
  await assertPermission(interaction, 'users.view');
  return listWithFilters(interaction, { status: 'ACTIVE' });
}

async function handleInactive(interaction, ctx) {
  await assertPermission(interaction, 'users.view');
  return listWithFilters(interaction, { status: 'INACTIVE' });
}

async function handleLeave(interaction, ctx) {
  await assertPermission(interaction, 'users.view');
  return listWithFilters(interaction, { onLeave: true });
}

async function handlePendingRemoval(interaction, ctx) {
  await assertPermission(interaction, 'users.view');

  const pending = await removalRequestRepo.listPending({ page: 1, pageSize: 25 });
  if (pending.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({
        title: 'No Pending Removals',
        description: 'There are no members with pending removal requests.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = pending.items.map((p) => '• <@' + p.discord_id + '>');
  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Members Pending Removal (' + pending.items.length + ')',
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRank(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'users.view');
  const rankName = params.rankName ?? interaction.options?.getString?.('name');

  if (!rankName) return openRankPicker(interaction);

  return listWithFilters(interaction, { status: 'ANY', robloxRankName: rankName });
}

async function handleRole(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'users.view');
  const roleKey = params.roleKey ?? interaction.options?.getString?.('key');

  if (!roleKey) return openMemberRolePicker(interaction);

  return listWithFilters(interaction, { status: 'ANY', roleKey: roleKey.toLowerCase() });
}

async function listWithFilters(interaction, filters) {
  const result = await userService.listMembers({ ...filters, page: 1, pageSize: 15 });

  if (result.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Members', description: 'No members match those filters.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  await paginate(interaction, {
    totalPages: result.totalPages,
    renderPage: async (page) => {
      const pageResult = await userService.listMembers({ ...filters, page, pageSize: 15 });
      const lines = pageResult.items.map((u) => {
        const rank = u.roblox_rank_name ? ' [' + u.roblox_rank_name + ']' : '';
        const status = u.status !== 'ACTIVE' ? ' `' + u.status + '`' : '';
        return '• <@' + u.discord_id + '> — ' + (u.roblox_username || 'unlinked') + rank + status;
      });
      return infoEmbed({
        title: 'Members (' + pageResult.total + ' total)',
        description: lines.join('\n'),
      });
    },
  });
}

async function openRankPicker(interaction) {
  const breakdown = await statisticsService.memberBreakdown();
  const ranks = (breakdown.byRobloxRank || []).slice(0, 25);

  if (ranks.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Ranks', description: 'No Roblox ranks are recorded.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = ranks.map((r) => ({
    label: truncatePlain(r.rankName, 100),
    description: truncatePlain(r.count + ' member(s)', 100),
    value: r.rankName,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId('member:pick-rank')
    .setPlaceholder('Pick a Roblox rank')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Filter by Roblox Rank', description: 'Pick a rank to filter members.' })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function openMemberRolePicker(interaction) {
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
    .setCustomId('member:pick-role')
    .setPlaceholder('Pick an internal role')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Filter by Internal Role', description: 'Pick a role to filter members.' })],
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
  list: handleList,
  active: handleActive,
  inactive: handleInactive,
  leave: handleLeave,
  'pending-removal': handlePendingRemoval,
  rank: handleRank,
  role: handleRole,
};
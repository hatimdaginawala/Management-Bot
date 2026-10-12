import {
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import * as userService from '../../services/user.service.js';
import * as statisticsService from '../../services/statistics.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import * as removalRequestRepo from '../../db/repositories/removalRequest.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import { paginate } from '../components/pagination.js';

export const data = new SlashCommandBuilder()
  .setName('members')
  .setDescription('Browse and filter group members.')
  .addSubcommand((sub) =>
    sub.setName('view').setDescription('Show a full profile card for a member.')
      .addUserOption((opt) => opt.setName('user').setDescription('Target user (default: yourself)'))
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List members with optional filters.')
      .addStringOption((opt) =>
        opt.setName('status').setDescription('Filter by status')
          .addChoices(
            { name: 'Any', value: 'ANY' },
            { name: 'Active', value: 'ACTIVE' },
            { name: 'Unverified', value: 'UNVERIFIED' },
            { name: 'Inactive', value: 'INACTIVE' },
            { name: 'Suspended', value: 'SUSPENDED' },
            { name: 'Left Roblox Group', value: 'LEFT_ROBLOX_GROUP' }
          )
      )
      .addStringOption((opt) => opt.setName('search').setDescription('Substring search (Discord or Roblox name)'))
  )
  .addSubcommand((sub) => sub.setName('active').setDescription('List active members.'))
  .addSubcommand((sub) => sub.setName('inactive').setDescription('List inactive/left members.'))
  .addSubcommand((sub) => sub.setName('leave').setDescription('List members currently on approved leave.'))
  .addSubcommand((sub) => sub.setName('pending-removal').setDescription('List members with pending removals.'))
  .addSubcommand((sub) =>
    sub.setName('rank').setDescription('List members by Roblox rank name.')
      .addStringOption((opt) => opt.setName('name').setDescription('Exact Roblox rank name').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName('role').setDescription('List members by internal role.')
      .addStringOption((opt) => opt.setName('key').setDescription('Role key').setRequired(true))
  )
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  await assertPermission(interaction, 'users.view');

  const sub = interaction.options.getSubcommand(true);

  if (sub === 'view') return handleView(interaction);

  const filters = { status: 'ACTIVE', page: 1, pageSize: 15 };

  switch (sub) {
    case 'list': {
      const status = interaction.options.getString('status') || 'ANY';
      const search = interaction.options.getString('search');
      filters.status = status;
      if (search) filters.search = search;
      break;
    }
    case 'active':
      filters.status = 'ACTIVE';
      break;
    case 'inactive':
      filters.status = 'INACTIVE';
      break;
    case 'leave':
      filters.onLeave = true;
      break;
    case 'pending-removal': {
      const pending = await removalRequestRepo.listPending({ page: 1, pageSize: 25 });
      if (pending.total === 0) {
        return interaction.reply({
          embeds: [infoEmbed({ title: 'No Pending Removals', description: 'There are no members with pending removal requests.' })],
          flags: MessageFlags.Ephemeral,
        });
      }
      const lines = pending.items.map((p) => '• <@' + p.discord_id + '>');
      return interaction.reply({
        embeds: [infoEmbed({
          title: 'Members Pending Removal (' + pending.items.length + ')',
          description: lines.join('\n'),
        })],
        flags: MessageFlags.Ephemeral,
      });
    }
    case 'rank':
      filters.robloxRankName = interaction.options.getString('name', true);
      filters.status = 'ANY';
      break;
    case 'role':
      filters.roleKey = interaction.options.getString('key', true).toLowerCase();
      filters.status = 'ANY';
      break;
  }

  const result = await userService.listMembers(filters);

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'No Members', description: 'No members match those filters.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await paginate(interaction, {
    totalPages: result.totalPages,
    renderPage: async (page) => {
      const pageResult = await userService.listMembers({ ...filters, page });
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

async function handleView(interaction) {
  const target = interaction.options.getUser('user') || interaction.user;

  const [profile, stats] = await Promise.all([
    userService.getMemberProfile(target.id),
    statisticsService.userStats(target.id).catch(() => null),
  ]);

  if (!profile) {
    return interaction.reply({
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
        u.quota_exempt ? '**Exempt:** ✅ ' + (u.quota_exempt_reason || '') : '**Exempt:** ❌',
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

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Member: ' + (u.discord_username || target.username),
      description: joinedTs ? 'Joined <t:' + joinedTs + ':R>' : null,
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function assertPermission(interaction, permissionKey) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission to perform this action.');
  const ok = await permissionService.hasPermission(user.id, permissionKey);
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');
}
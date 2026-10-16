// src/bot/commands/stats.js

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as statisticsService from '../../services/statistics.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import { openMenuForModule, replyOrUpdate } from '../menus/render.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Group statistics and analytics.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  return openMenuForModule(interaction, ctx, 'stats');
}

async function handleWindow(interaction, ctx, kind) {
  const fn = kind === 'daily' ? statisticsService.dailyStats
    : kind === 'weekly' ? statisticsService.weeklyStats
    : statisticsService.monthlyStats;

  const data = await fn({ top: 5 });

  const startTs = Math.floor(new Date(data.startAt).getTime() / 1000);
  const endTs = Math.floor(new Date(data.endAt).getTime() / 1000);

  const fields = [
    {
      name: 'Activity',
      value: ['**Events:** ' + data.summary.totalEvents, '**Attendance:** ' + data.summary.totalAttendance].join('\n'),
      inline: true,
    },
    {
      name: 'Quota',
      value: ['**Met:** ' + data.summary.quotaMet, '**Missed:** ' + data.summary.quotaMissed].join('\n'),
      inline: true,
    },
    {
      name: 'Discipline',
      value: ['**New Strikes:** ' + data.summary.newStrikes, '**Recovered:** ' + data.summary.recoveredStrikes].join('\n'),
      inline: true,
    },
  ];

  if (data.eventsByType.length > 0) {
    fields.push({
      name: 'Events by Type',
      value: data.eventsByType.map((e) => '`' + (e.typeKey || e._id) + '` ' + e.count).join(' • '),
      inline: false,
    });
  }

  if (data.topHosts.length > 0) {
    fields.push({
      name: 'Top Hosts',
      value: data.topHosts.map((h, i) => (i + 1) + '. <@' + h.discordId + '> — ' + h.count).join('\n'),
      inline: false,
    });
  }

  if (data.topAttendees.length > 0) {
    fields.push({
      name: 'Top Attendees',
      value: data.topAttendees.map((a, i) => (i + 1) + '. <@' + a.discordId + '> — ' + a.count).join('\n'),
      inline: false,
    });
  }

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: kind.charAt(0).toUpperCase() + kind.slice(1) + ' Summary' + (data.periodKey ? ' (' + data.periodKey + ')' : ''),
      description: 'Period: <t:' + startTs + ':f> → <t:' + endTs + ':f>',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleUser(interaction, ctx, params = {}) {
  const target = params.user ?? interaction.options?.getUser?.('user');

  if (!target) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Pick a User', description: 'Select a user to view stats for.' })],
      components: [new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('stats:pick-user')
          .setPlaceholder('Select a user')
          .setMinValues(1).setMaxValues(1)
      )],
      flags: MessageFlags.Ephemeral,
    });
  }

  const stats = await statisticsService.userStats(target.id);

  const roles = stats.roles.length ? stats.roles.map((r) => '`' + r.key + '`').join(', ') : '_none_';
  const recentQuota = stats.recentQuotaResults.length
    ? stats.recentQuotaResults.slice(0, 5).map((q) =>
        '• `' + q.periodKey + '` ' + q.category + ' — ' + q.actual + '/' + q.required + ' (' + q.status + ')'
      ).join('\n')
    : '_no recent results_';

  const fields = [
    {
      name: 'Identity',
      value: [
        '**Roblox:** ' + (stats.user.robloxUsername || '_not linked_'),
        '**Status:** `' + stats.user.status + '`',
        '**Quota Category:** `' + stats.user.quotaCategory + '`' + (stats.user.quotaExempt ? ' (exempt)' : ''),
      ].join('\n'),
      inline: false,
    },
    {
      name: 'Activity',
      value: [
        '**Events Hosted:** ' + stats.activity.totalEventsHosted,
        '**Events Attended:** ' + stats.activity.totalEventsAttended,
        '**Rank Changes:** ' + stats.activity.rankChanges,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Discipline',
      value: [
        '**Active Strikes:** ' + stats.strikes.active,
        '**Lifetime:** ' + stats.strikes.lifetime,
        '**Recovered:** ' + stats.strikes.recovered,
      ].join('\n'),
      inline: true,
    },
    { name: 'Roles', value: roles, inline: false },
  ];

  if (stats.activeLeave) {
    const endTs = Math.floor(new Date(stats.activeLeave.end_at).getTime() / 1000);
    fields.push({ name: 'Active Leave', value: 'Until <t:' + endTs + ':d> — ' + stats.activeLeave.reason, inline: false });
  }

  if (stats.activeNotices.length > 0) {
    fields.push({
      name: 'Active Notices',
      value: stats.activeNotices.map((n) => '• `' + n.type + '` — ' + n.reason).join('\n'),
      inline: false,
    });
  }

  fields.push({ name: 'Recent Quota', value: recentQuota, inline: false });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Stats for ' + target.username, fields })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEvents(interaction, ctx) {
  const stats = await statisticsService.eventStats();
  const byStatus = stats.byStatus;
  const statusLines = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']
    .map((s) => '**' + s + ':** ' + (byStatus[s] || 0)).join('\n');
  const typeLines = stats.byType.length ? stats.byType.map((t) => '`' + (t.typeKey || t._id) + '` ' + t.count).join(' • ') : '_none_';

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Event Statistics',
      description: 'Total events: **' + stats.total + '**',
      fields: [
        { name: 'By Status', value: statusLines, inline: true },
        { name: 'By Type', value: typeLines, inline: false },
      ],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAttendance(interaction, ctx) {
  const stats = await statisticsService.attendanceStats();

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Attendance Statistics',
      fields: [
        { name: 'Total Attendance', value: String(stats.totalAttendance), inline: true },
        { name: 'Unique Attendees', value: String(stats.uniqueAttendees), inline: true },
        { name: 'Unique Events', value: String(stats.uniqueEvents), inline: true },
        { name: 'Avg per Event', value: String(stats.avgPerEvent), inline: true },
      ],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHosts(interaction, ctx) {
  const hosts = await statisticsService.hostStats({ top: 10 });
  if (hosts.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Top Hosts', description: '_No approved events yet._' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = hosts.map((h, i) => {
    const rank = i < 3 ? medals[i] : ('`' + (i + 1) + '.`');
    const name = h.discordUsername ? '@' + h.discordUsername : '<@' + h.discordId + '>';
    return rank + ' **' + name + '** — ' + h.count + ' event(s)';
  });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Top Hosts (all time)', description: lines.join('\n') })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAttendees(interaction, ctx, params = {}) {
  const periodRaw = params.period ?? interaction.options?.getString?.('period') ?? 'all';
  let from = null;
  if (periodRaw === '30d') from = new Date(Date.now() - 30 * 86_400_000);
  else if (periodRaw === '90d') from = new Date(Date.now() - 90 * 86_400_000);

  const stats = await statisticsService.attendanceStats({ mode: 'byUser', from, limit: 10 });

  if (!stats.rows || stats.rows.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Top Attendees', description: '_No attendance records yet._' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = stats.rows.map((r, i) => {
    const rank = i < 3 ? medals[i] : ('`' + (i + 1) + '.`');
    return rank + ' <@' + r.discordId + '> — ' + r.count + ' event(s)';
  });

  const title = periodRaw === 'all' ? 'Top Attendees (all time)' : 'Top Attendees (last ' + periodRaw + ')';

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title, description: lines.join('\n') })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleQuota(interaction, ctx) {
  const stats = await statisticsService.quotaStats();
  const fields = [];
  for (const cat of ['STAFF', 'LOW_RANK']) {
    const s = stats[cat];
    fields.push({
      name: cat,
      value: ['**MET:** ' + s.MET, '**MISSED:** ' + s.MISSED, '**EXEMPT:** ' + s.EXEMPT].join('\n'),
      inline: true,
    });
  }
  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Quota Statistics (all time)', fields })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStrikes(interaction, ctx) {
  const stats = await statisticsService.strikeStats({ top: 10 });
  const byStatus = stats.byStatus || {};
  const statusLines = ['ACTIVE', 'RECOVERED', 'CANCELLED', 'EXPIRED']
    .map((s) => '**' + s + ':** ' + (byStatus[s] || 0)).join('\n');

  const fields = [
    { name: 'Total', value: String(stats.total), inline: true },
    { name: 'By Status', value: statusLines, inline: true },
  ];

  if (stats.topUsersWithActiveStrikes.length > 0) {
    fields.push({
      name: 'Top Users with Active Strikes',
      value: stats.topUsersWithActiveStrikes.map((u, i) => (i + 1) + '. <@' + u.discordId + '> — ' + u.count).join('\n'),
      inline: false,
    });
  }

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Strike Statistics', fields })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleMembers(interaction, ctx) {
  const breakdown = await statisticsService.memberBreakdown();

  const statusLines = Object.entries(breakdown.byStatus).map(([k, v]) => '**' + k + ':** ' + v).join('\n') || '_none_';
  const quotaLines = Object.entries(breakdown.byQuotaCategory).map(([k, v]) => '**' + k + ':** ' + v).join('\n') || '_none_';
  const roleLines = breakdown.byRole.length ? breakdown.byRole.map((r) => '`' + r.roleKey + '`: ' + r.count).join(', ') : '_none_';
  const rankLines = breakdown.byRobloxRank.slice(0, 10).length
    ? breakdown.byRobloxRank.slice(0, 10).map((r) => '`' + r.rankName + '`: ' + r.count).join(', ')
    : '_none_';

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Member Breakdown',
      fields: [
        { name: 'By Status', value: statusLines, inline: true },
        { name: 'By Quota Category', value: quotaLines, inline: true },
        { name: 'By Internal Role', value: roleLines, inline: false },
        { name: 'By Roblox Rank', value: rankLines, inline: false },
      ],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

export const HANDLERS = {
  daily: (i, c) => handleWindow(i, c, 'daily'),
  weekly: (i, c) => handleWindow(i, c, 'weekly'),
  monthly: (i, c) => handleWindow(i, c, 'monthly'),
  user: handleUser,
  events: handleEvents,
  attendance: handleAttendance,
  hosts: handleHosts,
  attendees: handleAttendees,
  quota: handleQuota,
  strikes: handleStrikes,
  members: handleMembers,
};
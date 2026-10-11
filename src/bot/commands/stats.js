import {
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import * as statisticsService from '../../services/statistics.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Group statistics and analytics.')
  .addSubcommand((sub) =>
    sub.setName('daily').setDescription('Daily summary.')
  )
  .addSubcommand((sub) =>
    sub.setName('weekly').setDescription('Weekly summary.')
  )
  .addSubcommand((sub) =>
    sub.setName('monthly').setDescription('Monthly summary.')
  )
  .addSubcommand((sub) =>
    sub
      .setName('user')
      .setDescription('Per-user dashboard.')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Target user (default: yourself)')
      )
  )
  .addSubcommand((sub) =>
    sub.setName('events').setDescription('Event statistics.')
  )
  .addSubcommand((sub) =>
    sub.setName('attendance').setDescription('Attendance statistics.')
  )
  .addSubcommand((sub) =>
    sub.setName('hosts').setDescription('Top event hosts.')
  )
  .addSubcommand((sub) =>
    sub.setName('quota').setDescription('Quota completion statistics.')
  )
  .addSubcommand((sub) =>
    sub.setName('strikes').setDescription('Strike statistics.')
  )  .addSubcommand((sub) =>
    sub
      .setName('attendees')
      .setDescription('Top attendees leaderboard.')
      .addStringOption((opt) =>
        opt
          .setName('period')
          .setDescription('Time window')
          .addChoices(
            { name: 'All time', value: 'all' },
            { name: 'Last 30 days', value: '30d' },
            { name: 'Last 90 days', value: '90d' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName('members').setDescription('Member breakdown.')
  )
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  await assertPermission(interaction, 'statistics.view');

  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'daily':       return handleWindow(interaction, 'daily');
    case 'weekly':      return handleWindow(interaction, 'weekly');
    case 'monthly':     return handleWindow(interaction, 'monthly');
    case 'user':        return handleUser(interaction);
    case 'events':      return handleEvents(interaction);
    case 'attendance':  return handleAttendance(interaction);
    case 'hosts':       return handleHosts(interaction);
    case 'quota':       return handleQuota(interaction);
    case 'strikes':     return handleStrikes(interaction);
    case 'members':     return handleMembers(interaction);
        case 'attendees':   return handleAttendees(interaction);
    default:
      throw new Error('Unknown /stats subcommand: ' + sub);
  }
}

// ============================================================
//  Window summaries — daily / weekly / monthly
// ============================================================

async function handleWindow(interaction, kind) {
  const fn =
    kind === 'daily' ? statisticsService.dailyStats
    : kind === 'weekly' ? statisticsService.weeklyStats
    : statisticsService.monthlyStats;

  const data = await fn({ top: 5 });

  const startTs = Math.floor(new Date(data.startAt).getTime() / 1000);
  const endTs = Math.floor(new Date(data.endAt).getTime() / 1000);

  const fields = [
    {
      name: 'Activity',
      value: [
        '**Events:** ' + data.summary.totalEvents,
        '**Attendance:** ' + data.summary.totalAttendance,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Quota',
      value: [
        '**Met:** ' + data.summary.quotaMet,
        '**Missed:** ' + data.summary.quotaMissed,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Discipline',
      value: [
        '**New Strikes:** ' + data.summary.newStrikes,
        '**Recovered:** ' + data.summary.recoveredStrikes,
      ].join('\n'),
      inline: true,
    },
  ];

  if (data.eventsByType.length > 0) {
    fields.push({
      name: 'Events by Type',
      value: data.eventsByType.map((e) => '`' + e.typeKey + '` ' + e.count).join(' • '),
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

  return interaction.reply({
    embeds: [infoEmbed({
      title: capitalize(kind) + ' Summary' + (data.periodKey ? ' (' + data.periodKey + ')' : ''),
      description: 'Period: <t:' + startTs + ':f> → <t:' + endTs + ':f>',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  user
// ============================================================

async function handleUser(interaction) {
  const target = interaction.options.getUser('user') || interaction.user;
  const stats = await statisticsService.userStats(target.id);

  const roles = stats.roles.length
    ? stats.roles.map((r) => '`' + r.key + '`').join(', ')
    : '_none_';

  const recentQuota = stats.recentQuotaResults.length
    ? stats.recentQuotaResults
        .slice(0, 5)
        .map((q) => '• `' + q.periodKey + '` ' + q.category + ' — ' + q.actual + '/' + q.required + ' (' + q.status + ')')
        .join('\n')
    : '_no recent results_';

  const fields = [
    {
      name: 'Identity',
      value: [
        '**Roblox:** ' + (stats.user.robloxUsername || '_not linked_'),
        '**Status:** `' + stats.user.status + '`',
        '**Quota Category:** `' + stats.user.quotaCategory + '`' +
          (stats.user.quotaExempt ? ' (exempt)' : ''),
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
    const endTs = Math.floor(new Date(stats.activeLeave.endAt).getTime() / 1000);
    fields.push({
      name: 'Active Leave',
      value: 'Until <t:' + endTs + ':d> — ' + stats.activeLeave.reason,
      inline: false,
    });
  }

  if (stats.activeNotices.length > 0) {
    fields.push({
      name: 'Active Notices',
      value: stats.activeNotices.map((n) => '• `' + n.type + '` — ' + n.reason).join('\n'),
      inline: false,
    });
  }

  fields.push({ name: 'Recent Quota', value: recentQuota, inline: false });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Stats for ' + target.username,
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  events / attendance / hosts / quota / strikes / members
// ============================================================

async function handleEvents(interaction) {
  const stats = await statisticsService.eventStats();

  const byStatus = stats.byStatus;
  const statusLines = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']
    .map((s) => '**' + s + ':** ' + (byStatus[s] || 0))
    .join('\n');

  const typeLines = stats.byType.length
    ? stats.byType.map((t) => '`' + t.typeKey + '` ' + t.count).join(' • ')
    : '_none_';

  return interaction.reply({
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

async function handleAttendance(interaction) {
  const stats = await statisticsService.attendanceStats();

  return interaction.reply({
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

async function handleHosts(interaction) {
  const hosts = await statisticsService.hostStats({ top: 10 });

  if (hosts.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Top Hosts',
        description: '_No approved events yet._',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = hosts.map((h, i) => {
    const rank = i < 3 ? medals[i] : ('`' + (i + 1) + '.`');
    const name = h.discordUsername ? '@' + h.discordUsername : '<@' + h.discordId + '>';
    return rank + ' **' + name + '** — ' + h.count + ' event(s)';
  });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Top Hosts (all time)',
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAttendees(interaction) {
  const periodRaw = interaction.options.getString('period') || 'all';

  let from = null;
  if (periodRaw === '30d') from = new Date(Date.now() - 30 * 86_400_000);
  else if (periodRaw === '90d') from = new Date(Date.now() - 90 * 86_400_000);

  // Reuse the attendance byUser aggregation
  const stats = await statisticsService.attendanceStats({
    mode: 'byUser',
    from,
    limit: 10,
  });

  if (!stats.rows || stats.rows.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Top Attendees',
        description: '_No attendance records yet._',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = stats.rows.map((r, i) => {
    const rank = i < 3 ? medals[i] : ('`' + (i + 1) + '.`');
    return rank + ' <@' + r.discordId + '> — ' + r.count + ' event(s)';
  });

  const title = periodRaw === 'all'
    ? 'Top Attendees (all time)'
    : 'Top Attendees (last ' + periodRaw + ')';

  return interaction.reply({
    embeds: [infoEmbed({
      title,
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleQuota(interaction) {
  const stats = await statisticsService.quotaStats();

  const fields = [];
  for (const cat of ['STAFF', 'LOW_RANK']) {
    const s = stats[cat];
    fields.push({
      name: cat,
      value: [
        '**MET:** ' + s.MET,
        '**MISSED:** ' + s.MISSED,
        '**EXEMPT:** ' + s.EXEMPT,
      ].join('\n'),
      inline: true,
    });
  }

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Quota Statistics (all time)',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStrikes(interaction) {
  const stats = await statisticsService.strikeStats({ top: 10 });

  const byStatus = stats.byStatus || {};
  const statusLines = ['ACTIVE', 'RECOVERED', 'CANCELLED', 'EXPIRED']
    .map((s) => '**' + s + ':** ' + (byStatus[s] || 0))
    .join('\n');

  const fields = [
    { name: 'Total', value: String(stats.total), inline: true },
    { name: 'By Status', value: statusLines, inline: true },
  ];

  if (stats.topUsersWithActiveStrikes.length > 0) {
    fields.push({
      name: 'Top Users with Active Strikes',
      value: stats.topUsersWithActiveStrikes
        .map((u, i) => (i + 1) + '. <@' + u.discordId + '> — ' + u.count)
        .join('\n'),
      inline: false,
    });
  }

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Strike Statistics',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleMembers(interaction) {
  const breakdown = await statisticsService.memberBreakdown();

  const statusLines = Object.entries(breakdown.byStatus)
    .map(([k, v]) => '**' + k + ':** ' + v)
    .join('\n') || '_none_';

  const quotaLines = Object.entries(breakdown.byQuotaCategory)
    .map(([k, v]) => '**' + k + ':** ' + v)
    .join('\n') || '_none_';

  const roleLines = breakdown.byRole.length
    ? breakdown.byRole.map((r) => '`' + r.roleKey + '`: ' + r.count).join(', ')
    : '_none_';

  const rankLines = breakdown.byRobloxRank.slice(0, 10).length
    ? breakdown.byRobloxRank.slice(0, 10).map((r) => '`' + r.rankName + '`: ' + r.count).join(', ')
    : '_none_';

  return interaction.reply({
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

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
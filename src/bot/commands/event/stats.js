import { MessageFlags } from 'discord.js';
import * as statisticsService from '../../../services/statistics.service.js';
import { infoEmbed } from '../../embedBuilders.js';
import { assertPermission } from './approve.js';

export async function handleStats(interaction) {
  await assertPermission(interaction, 'statistics.view');

  const typeKey = interaction.options.getString('type');
  const periodRaw = interaction.options.getString('period') || '30d';
  const periodDays = { '7d': 7, '30d': 30, '90d': 90 }[periodRaw] || 30;

  const now = new Date();
  const currentStart = new Date(now.getTime() - periodDays * 86_400_000);
  const previousStart = new Date(now.getTime() - 2 * periodDays * 86_400_000);

  const [current, previous] = await Promise.all([
    statisticsService.eventCountsInWindow({ from: currentStart, to: now }),
    statisticsService.eventCountsInWindow({ from: previousStart, to: currentStart }),
  ]);

  const delta = current.total - previous.total;
  const pct = previous.total > 0
    ? Math.round((delta / previous.total) * 100)
    : null;

  const trendEmoji = delta > 0 ? '📈' : delta < 0 ? '📉' : '➡️';
  const trendText = pct === null
    ? '_no previous data_'
    : trendEmoji + ' **' + (delta >= 0 ? '+' : '') + delta + '** (' +
      (pct >= 0 ? '+' : '') + pct + '%)';

  const bs = current.byStatus;
  const fields = [
    {
      name: 'Current Period',
      value: [
        '**Total:** ' + current.total,
        '**Approved:** ' + (bs.APPROVED || 0) + '  •  **Pending:** ' + (bs.PENDING || 0),
        '**Rejected:** ' + (bs.REJECTED || 0) + '  •  **Cancelled:** ' + (bs.CANCELLED || 0),
      ].join('\n'),
      inline: false,
    },
    {
      name: 'Trend vs Previous ' + periodDays + ' Days',
      value: trendText + '\nPrevious: **' + previous.total + '**',
      inline: false,
    },
  ];

  if (!typeKey && current.byType.length > 0) {
    fields.push({
      name: 'By Type',
      value: current.byType.map((t) => '`' + t.typeKey + '` — ' + t.count).join('\n'),
      inline: false,
    });
  }

  const fromTs = Math.floor(currentStart.getTime() / 1000);
  const toTs = Math.floor(now.getTime() / 1000);
  const title = typeKey ? 'Event Stats — `' + typeKey + '`' : 'Event Stats';

  return interaction.reply({
    embeds: [infoEmbed({
      title,
      description: 'Period: <t:' + fromTs + ':d> → <t:' + toTs + ':d>',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function countEvents({ from, to, typeKey }) {
  const result = await eventService.listEvents({
    status: 'ANY',
    eventTypeKey: typeKey || undefined,
    from,
    to,
    page: 1,
    pageSize: 1,
  });

  // We only need counts; use aggregation-style counts by re-querying with filters.
  const [total, approved, pending, rejected, cancelled] = await Promise.all([
    count({ from, to, typeKey }),
    count({ from, to, typeKey, status: 'APPROVED' }),
    count({ from, to, typeKey, status: 'PENDING' }),
    count({ from, to, typeKey, status: 'REJECTED' }),
    count({ from, to, typeKey, status: 'CANCELLED' }),
  ]);

  // For byType breakdown, aggregate over approved + pending (any active state).
  const byType = typeKey
    ? []
    : await eventService.aggregateEventCountByType({ from, to });

  return {
    total,
    byStatus: { APPROVED: approved, PENDING: pending, REJECTED: rejected, CANCELLED: cancelled },
    byType,
  };
}

async function count(filter) {
  const r = await eventService.listEvents({
    status: filter.status || 'ANY',
    eventTypeKey: filter.typeKey || undefined,
    from: filter.from,
    to: filter.to,
    page: 1,
    pageSize: 1,
  });
  return r.total;
}
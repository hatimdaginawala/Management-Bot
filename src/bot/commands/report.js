// src/bot/commands/report.js

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as reportService from '../../services/report.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import { paginate } from '../components/pagination.js';
import { formatRelative, truncatePlain } from '../utils/format.js';
import { openMenuForModule, replyOrUpdate } from '../menus/render.js';

export const data = new SlashCommandBuilder()
  .setName('report')
  .setDescription('Weekly, monthly, and manual reports.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  return openMenuForModule(interaction, ctx, 'report');
}

async function handleWeekly(interaction, ctx) {
  await assertPermission(interaction, 'reports.generate');
  return generateAndReply(interaction, 'WEEKLY');
}

async function handleMonthly(interaction, ctx) {
  await assertPermission(interaction, 'reports.generate');
  return generateAndReply(interaction, 'MONTHLY');
}

async function generateAndReply(interaction, kind) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const report = kind === 'WEEKLY'
    ? await reportService.generateWeeklyReport({ generatedBy: interaction.user.id })
    : await reportService.generateMonthlyReport({ generatedBy: interaction.user.id });

  const startTs = Math.floor(new Date(report.period_start).getTime() / 1000);
  const endTs = Math.floor(new Date(report.period_end).getTime() / 1000);

  return interaction.editReply({
    embeds: [infoEmbed({
      title: kind.charAt(0) + kind.slice(1).toLowerCase() + ' Report Generated',
      description: 'Period: <t:' + startTs + ':f> → <t:' + endTs + ':f>',
      fields: [
        { name: 'Report ID', value: '`' + report.id + '`', inline: false },
        { name: 'Report Key', value: '`' + (report.report_key || 'N/A') + '`', inline: true },
        { name: 'Total Events', value: String(report.total_events), inline: true },
        { name: 'Total Attendance', value: String(report.total_attendance), inline: true },
      ],
    })],
  });
}

async function handleList(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'reports.view');
  const kind = params.kind ?? interaction.options?.getString?.('kind');

  const result = await reportService.listReports({ kind, page: 1, pageSize: 10 });
  if (result.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'No Reports', description: 'No reports have been generated yet.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  await paginate(interaction, {
    totalPages: result.totalPages,
    renderPage: async (page) => {
      const pageResult = await reportService.listReports({ kind, page, pageSize: 10 });
      const lines = pageResult.items.map((r) => {
        const ts = Math.floor(new Date(r.generated_at).getTime() / 1000);
        const key = r.report_key || 'manual';
        return '• `' + r.kind + '` `' + key + '` — <t:' + ts + ':R> — `' + r.id + '`';
      });
      return infoEmbed({
        title: 'Stored Reports (' + pageResult.total + ' total)',
        description: lines.join('\n'),
      });
    },
  });
}

async function handleViewPick(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'reports.view');

  const selectedId = params.reportId ?? (interaction.isStringSelectMenu?.() ? interaction.values?.[0] : null);

  // Phase 1: no ID yet → show picker.
  if (!selectedId) {
    const result = await reportService.listReports({ page: 1, pageSize: 25 });
    if (result.total === 0) {
      return replyOrUpdate(interaction, {
        embeds: [infoEmbed({ title: 'No Reports', description: 'No reports have been generated yet.' })],
        flags: MessageFlags.Ephemeral,
      });
    }

    const options = result.items.map((r) => {
      const key = r.report_key || 'manual';
      return {
        label: truncatePlain(r.kind + ' — ' + key, 100),
        description: truncatePlain(formatRelative(r.generated_at), 100),
        value: String(r.id),
      };
    });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('report:pick:view')
      .setPlaceholder('Pick a report')
      .setMinValues(1).setMaxValues(1).addOptions(options);

    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'View Report', description: 'Pick a report to view.' })],
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Phase 2: we have an ID → show it.
  const report = await reportService.getReportById(selectedId);
  const payload = report.rendered_payload_json || reportService.renderDiscordEmbed(report);

  return replyOrUpdate(interaction, {
    embeds: payload.embeds || [infoEmbed({ title: 'Report', description: 'Stored report data.' })],
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
  weekly: handleWeekly,
  monthly: handleMonthly,
  list: handleList,
  view: handleViewPick,
};
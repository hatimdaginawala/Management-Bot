import {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import * as reportService from '../../services/report.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import { paginate } from '../components/pagination.js';

export const data = new SlashCommandBuilder()
  .setName('report')
  .setDescription('Weekly, monthly, and manual reports.')
  .addSubcommand((sub) => sub.setName('weekly').setDescription("Generate this week's report."))
  .addSubcommand((sub) => sub.setName('monthly').setDescription("Generate this month's report."))
  .addSubcommand((sub) => sub.setName('generate').setDescription('Generate a manual report for a date range.'))
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List stored reports.')
      .addStringOption((opt) =>
        opt.setName('kind').setDescription('Filter by kind')
          .addChoices(
            { name: 'Weekly', value: 'WEEKLY' },
            { name: 'Monthly', value: 'MONTHLY' },
            { name: 'Manual', value: 'MANUAL' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName('view').setDescription('View a stored report.')
      .addStringOption((opt) => opt.setName('reportkey').setDescription('Report ID').setRequired(true))
  )
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'weekly':   return handleGenerate(interaction, 'WEEKLY');
    case 'monthly':  return handleGenerate(interaction, 'MONTHLY');
    case 'generate': return handleManualModal(interaction);
    case 'list':     return handleList(interaction);
    case 'view':     return handleView(interaction);
    default:
      throw new Error('Unknown /report subcommand: ' + sub);
  }
}

async function handleGenerate(interaction, kind) {
  await assertPermission(interaction, 'reports.generate');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

async function handleManualModal(interaction) {
  await assertPermission(interaction, 'reports.generate');

  const modal = new ModalBuilder()
    .setCustomId('modal:report-generate')
    .setTitle('Generate Manual Report');

  const fromInput = new TextInputBuilder()
    .setCustomId('from').setLabel('From (YYYY-MM-DD)')
    .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(10).setMaxLength(10);

  const toInput = new TextInputBuilder()
    .setCustomId('to').setLabel('To (YYYY-MM-DD)')
    .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(10).setMaxLength(10);

  const labelInput = new TextInputBuilder()
    .setCustomId('label').setLabel('Label (optional)')
    .setPlaceholder('e.g. "October ceremony review"')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80);

  modal.addComponents(
    new ActionRowBuilder().addComponents(fromInput),
    new ActionRowBuilder().addComponents(toInput),
    new ActionRowBuilder().addComponents(labelInput)
  );

  return interaction.showModal(modal);
}

async function handleList(interaction) {
  await assertPermission(interaction, 'reports.view');

  const kind = interaction.options.getString('kind');
  const result = await reportService.listReports({ kind, page: 1, pageSize: 10 });

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'No Reports', description: 'No reports have been generated yet.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

async function handleView(interaction) {
  await assertPermission(interaction, 'reports.view');
  const id = interaction.options.getString('reportkey', true);

  const report = await reportService.getReportById(id);
  const payload = report.rendered_payload_json || reportService.renderDiscordEmbed(report);

  return interaction.reply({
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
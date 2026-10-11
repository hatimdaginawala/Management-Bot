import { MessageFlags } from 'discord.js';
import * as reportService from '../../services/report.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed } from '../embedBuilders.js';

export const customId = 'modal:report-generate';
export const meta = {};

export async function execute(interaction) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user._id, 'reports.generate');
  if (!ok) throw new AuthorizationError('You do not have permission to generate reports.');

  const fromRaw = interaction.fields.getTextInputValue('from').trim();
  const toRaw = interaction.fields.getTextInputValue('to').trim();
  const label = interaction.fields.getTextInputValue('label').trim() || null;

  const from = parseDate(fromRaw, 'From');
  const to = parseDate(toRaw, 'To');
  if (to <= from) throw new ValidationError('"To" must be after "From".');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const report = await reportService.generateManualReport({
    from,
    to,
    generatedBy: interaction.user.id,
    label,
  });

  const startTs = Math.floor(new Date(report.periodStart).getTime() / 1000);
  const endTs = Math.floor(new Date(report.periodEnd).getTime() / 1000);

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Manual Report Generated',
      description: 'Period: <t:' + startTs + ':f> → <t:' + endTs + ':f>',
      fields: [
        { name: 'Report ID', value: '`' + report._id + '`', inline: false },
        ...(label ? [{ name: 'Label', value: label, inline: false }] : []),
        { name: 'Total Events', value: String(report.summary.totalEvents), inline: true },
        { name: 'Total Attendance', value: String(report.summary.totalAttendance), inline: true },
      ],
    })],
  });
}

function parseDate(raw, label) {
  const d = new Date(raw + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(label + ' must be a valid YYYY-MM-DD date.');
  }
  return d;
}
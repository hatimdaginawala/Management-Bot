import { MessageFlags } from 'discord.js';
import * as noticeService from '../../services/notice.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { dmNoticeCreated } from '../utils/userDm.js';

export const customId = 'modal:notice-create';
export const meta = {};

export async function execute(interaction) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user._id, 'notice.create');
  if (!ok) throw new AuthorizationError('You do not have permission to create notices.');

  const session = sessions.getSession('notice:create', interaction.user.id);
  if (!session || !session.userId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Session Expired', description: 'Please run `/notice create` again.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const type = interaction.fields.getTextInputValue('type').trim().toUpperCase();
  if (!['INACTIVITY', 'WARNING', 'ADMINISTRATIVE', 'OTHER'].includes(type)) {
    throw new ValidationError('Type must be INACTIVITY, WARNING, ADMINISTRATIVE, or OTHER.');
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (reason.length < 3) throw new ValidationError('Reason must be at least 3 characters.');

  const endRaw = interaction.fields.getTextInputValue('endAt').trim();
  let endAt = null;
  if (endRaw) {
    const d = new Date(endRaw + 'T23:59:59.999Z');
    if (Number.isNaN(d.getTime())) throw new ValidationError('End date must be YYYY-MM-DD.');
    endAt = d;
  }

  const exemptRaw = interaction.fields.getTextInputValue('grantsQuotaExemption').trim().toLowerCase();
  let grantsQuotaExemption = null;
  if (exemptRaw === 'yes' || exemptRaw === 'y' || exemptRaw === 'true') grantsQuotaExemption = true;
  else if (exemptRaw === 'no' || exemptRaw === 'n' || exemptRaw === 'false') grantsQuotaExemption = false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const notice = await noticeService.createNotice(interaction.user.id, {
    targetDiscordId: session.userId,
    type,
    reason,
    endAt,
    grantsQuotaExemption,
  });

  sessions.clearSession('notice:create', interaction.user.id);

  // DM the target user.
  await dmNoticeCreated(interaction.client, notice, { actorId: interaction.user.id });

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Notice Created',
      description: 'A notice has been created for <@' + session.userId + '>.',
      fields: [
        { name: 'Type', value: '`' + notice.type + '`', inline: true },
        { name: 'Exempt', value: notice.grantsQuotaExemption ? 'yes' : 'no', inline: true },
        ...(notice.endAt ? [{ name: 'Ends', value: '<t:' + Math.floor(new Date(notice.endAt).getTime() / 1000) + ':d>', inline: true }] : []),
      ],
    })],
  });
}
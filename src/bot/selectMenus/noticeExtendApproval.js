import { MessageFlags } from 'discord.js';
import { Notice } from '../../models/index.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed } from '../embedBuilders.js';
import { sendUserDm } from '../utils/userDm.js';
import { COLORS } from '../embedBuilders.js';

export const customId = [
  'notice:extension:approve:request',
  'notice:extension:reject:request',
];
export const meta = {};

export async function execute(interaction) {
  const kind = interaction.customId.split(':')[2];
  const noticeId = interaction.values[0];

  const actor = await User.findOne({ discordId: interaction.user.id });
  if (!actor) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(actor._id, 'notice.manage');
  if (!ok) throw new AuthorizationError('You do not have permission to review notices.');

  const notice = await Notice.findById(noticeId);
  if (!notice || notice.pendingExtension?.status !== 'PENDING') {
    return interaction.update({
      embeds: [errorEmbed({ title: 'No Pending Request', description: 'This notice has no pending extension.' })],
      components: [],
    });
  }

  if (kind === 'approve') {
    notice.endAt = notice.pendingExtension.newEndAt;
    notice.pendingExtension.status = 'APPROVED';
    notice.pendingExtension.reviewedBy = interaction.user.id;
    notice.pendingExtension.reviewedAt = new Date();
    await notice.save();

    await sendUserDm(interaction.client, {
      discordId: notice.discordId,
      title: 'Notice Extension Approved',
      color: COLORS.SUCCESS,
      description: 'Your notice extension was approved.',
      fields: [
        { name: 'New End Date', value: '<t:' + Math.floor(new Date(notice.endAt).getTime() / 1000) + ':d>', inline: true },
        { name: 'Approved By', value: '<@' + interaction.user.id + '>', inline: true },
      ],
    });

    return interaction.update({
      embeds: [successEmbed({
        title: 'Extension Approved',
        description: 'Notice for <@' + notice.discordId + '> extended to <t:' + Math.floor(new Date(notice.endAt).getTime() / 1000) + ':d>.',
      })],
      components: [],
    });
  }

  // reject
  notice.pendingExtension.status = 'REJECTED';
  notice.pendingExtension.reviewedBy = interaction.user.id;
  notice.pendingExtension.reviewedAt = new Date();
  await notice.save();

  await sendUserDm(interaction.client, {
    discordId: notice.discordId,
    title: 'Notice Extension Rejected',
    color: COLORS.ERROR,
    description: 'Your notice extension request was rejected.',
    fields: [
      { name: 'Reviewed By', value: '<@' + interaction.user.id + '>', inline: true },
    ],
  });

  return interaction.update({
    embeds: [successEmbed({
      title: 'Extension Rejected',
      description: 'Extension request for <@' + notice.discordId + '> was rejected.',
    })],
    components: [],
  });
}
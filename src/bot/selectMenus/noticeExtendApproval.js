import { MessageFlags } from 'discord.js';
import * as noticeService from '../../services/notice.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed, COLORS } from '../embedBuilders.js';
import { sendUserDm } from '../utils/userDm.js';

export const customId = [
  'notice:extension:approve:request',
  'notice:extension:reject:request',
];
export const meta = {};

export async function execute(interaction) {
  const kind = interaction.customId.split(':')[2];
  const noticeId = interaction.values[0];

  const actor = await userRepo.findByDiscordId(interaction.user.id);
  if (!actor) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(actor.id, 'notice.manage');
  if (!ok) throw new AuthorizationError('You do not have permission to review notices.');

  if (kind === 'approve') {
    const notice = await noticeService.approveExtension(interaction.user.id, noticeId, {
      reviewReason: null,
    });

    await sendUserDm(interaction.client, {
      discordId: notice.discord_id,
      title: 'Notice Extension Approved',
      color: COLORS.SUCCESS,
      description: 'Your notice extension was approved.',
      fields: [
        { name: 'New End Date', value: '<t:' + Math.floor(new Date(notice.end_at).getTime() / 1000) + ':d>', inline: true },
        { name: 'Approved By', value: '<@' + interaction.user.id + '>', inline: true },
      ],
    });

    return interaction.update({
      embeds: [successEmbed({
        title: 'Extension Approved',
        description: 'Notice for <@' + notice.discord_id + '> extended to <t:' + Math.floor(new Date(notice.end_at).getTime() / 1000) + ':d>.',
      })],
      components: [],
    });
  }

  // reject — opens modal? No, direct reject with fixed reason.
  const notice = await noticeService.rejectExtension(interaction.user.id, noticeId, {
    reviewReason: 'Rejected by reviewer',
  });

  await sendUserDm(interaction.client, {
    discordId: notice.discord_id,
    title: 'Notice Extension Rejected',
    color: COLORS.ERROR,
    description: 'Your notice extension request was rejected.',
    fields: [{ name: 'Reviewed By', value: '<@' + interaction.user.id + '>', inline: true }],
  });

  return interaction.update({
    embeds: [successEmbed({
      title: 'Extension Rejected',
      description: 'Extension request for <@' + notice.discord_id + '> was rejected.',
    })],
    components: [],
  });
}
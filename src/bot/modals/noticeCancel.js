import { MessageFlags } from 'discord.js';
import * as noticeService from '../../services/notice.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { dmNoticeCancelled } from '../utils/userDm.js';

export const customId = 'modal:notice-cancel';
export const meta = {};

export async function execute(interaction) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'notice.manage');
  if (!ok) throw new AuthorizationError('You do not have permission to cancel notices.');

  const session = sessions.getSession('notice:cancel', interaction.user.id);
  if (!session || !session.noticeId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Session Expired', description: 'Please run `/notice cancel` again.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (reason.length < 3) throw new ValidationError('Reason must be at least 3 characters.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await noticeService.cancelNotice(interaction.user.id, session.noticeId, { reason });
  sessions.clearSession('notice:cancel', interaction.user.id);

  if (result.cancelled && result.notice?.discord_id) {
    await dmNoticeCancelled(interaction.client, result.notice, {
      actorId: interaction.user.id,
      reason,
    });
  }

  return interaction.editReply({
    embeds: [successEmbed({
      title: result.cancelled ? 'Notice Cancelled' : 'Already Cancelled',
      description: 'Notice for <@' + (result.notice?.discord_id || 'unknown') + '> has been updated.',
      fields: [{ name: 'Reason', value: reason, inline: false }],
    })],
  });
}
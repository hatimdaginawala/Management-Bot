import { MessageFlags } from 'discord.js';
import * as leaveService from '../../services/leave.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed, COLORS } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { dmLeaveUser } from '../utils/leaveDm.js';

export const customId = 'modal:leave-end';
export const meta = {};

export async function execute(interaction) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'leave.manage');
  if (!ok) throw new AuthorizationError('You do not have permission to end leaves.');

  const session = sessions.getSession('leave:end', interaction.user.id);
  if (!session || !session.leaveId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Session Expired', description: 'Please run `/leave end` again.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const reason = interaction.fields.getTextInputValue('reason').trim() || null;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await leaveService.endLeave(interaction.user.id, session.leaveId, { reason });
  sessions.clearSession('leave:end', interaction.user.id);

  if (result.ended && result.leave?.discord_id) {
    await dmLeaveUser(interaction.client, result.leave, {
      title: 'Leave Ended',
      color: COLORS.WARNING,
      actorId: interaction.user.id,
      actorLabel: 'Ended By',
      reason: reason || null,
      extraLine: 'Your leave was ended early by an administrator. You are once again subject to weekly quota.',
    });
  }

  return interaction.editReply({
    embeds: [successEmbed({
      title: result.ended ? 'Leave Ended' : 'Already Ended',
      description: result.ended && result.leave?.discord_id
        ? 'Leave for <@' + result.leave.discord_id + '> has been ended early.'
        : 'This leave is no longer active.',
      ...(reason ? { fields: [{ name: 'Reason', value: reason, inline: false }] } : {}),
    })],
  });
}
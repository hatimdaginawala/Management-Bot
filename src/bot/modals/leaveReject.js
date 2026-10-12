import { MessageFlags } from 'discord.js';
import * as leaveService from '../../services/leave.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed, COLORS } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { dmLeaveUser } from '../utils/leaveDm.js';

export const customId = 'modal:leave-reject';
export const meta = {};

export async function execute(interaction) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'leave.reject');
  if (!ok) throw new AuthorizationError('You do not have permission to reject leaves.');

  const session = sessions.getSession('leave:reject', interaction.user.id);
  if (!session || !session.leaveId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Session Expired', description: 'Please run `/leave reject` again.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (reason.length < 3) throw new ValidationError('Reason must be at least 3 characters.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const leave = await leaveService.rejectLeave(interaction.user.id, session.leaveId, { reason });
  sessions.clearSession('leave:reject', interaction.user.id);

  await dmLeaveUser(interaction.client, leave, {
    title: 'Leave Rejected',
    color: COLORS.ERROR,
    actorId: interaction.user.id,
    actorLabel: 'Reviewed By',
    reason,
    extraLine: 'Your leave request was rejected. Contact High Command if you believe this is an error.',
  });

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Leave Rejected',
      description: 'Leave for <@' + leave.discord_id + '> was rejected.',
      fields: [{ name: 'Reason', value: reason, inline: false }],
    })],
  });
}
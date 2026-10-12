import { MessageFlags } from 'discord.js';
import * as attendanceService from '../../services/attendance.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { successEmbed, errorEmbed } from '../embedBuilders.js';
import { AuthorizationError } from '../../utils/errors.js';
import * as sessions from '../sessions.js';

export const customId = 'modal:attendance-remove';
export const meta = {};

export async function execute(interaction) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'attendance.manage');
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');

  const session = sessions.getSession('attendance:remove', interaction.user.id);
  if (!session || !session.userId || !session.eventId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Session Expired', description: 'Please run `/attendance remove` again.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await attendanceService.removeManualAttendance(interaction.user.id, {
    eventId: session.eventId,
    userDiscordId: session.userId,
    reason,
  });

  sessions.clearSession('attendance:remove', interaction.user.id);

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Attendance Removed',
      description: 'Removed <@' + session.userId + '> from event `' + session.eventId + '`.',
      fields: [{ name: 'Reason', value: reason, inline: false }],
    })],
  });
}
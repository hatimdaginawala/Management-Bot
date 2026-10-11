import { MessageFlags } from 'discord.js';
import * as attendanceService from '../../services/attendance.service.js';
import * as permissionService from '../../services/permission.service.js';
import { successEmbed, errorEmbed } from '../embedBuilders.js';
import { AuthorizationError } from '../../utils/errors.js';
import { User } from '../../models/index.js';
import * as sessions from '../sessions.js';

export const customId = 'modal:attendance-add';
export const meta = {};

export async function execute(interaction) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user._id, 'attendance.manage');
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');

  const session = sessions.getSession('attendance:add', interaction.user.id);
  if (!session || !session.userId || !session.eventId) {
    return interaction.reply({
      embeds: [errorEmbed({
        title: 'Session Expired',
        description: 'Please run `/attendance add` again.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await attendanceService.addManualAttendance(interaction.user.id, {
    eventId: session.eventId,
    userDiscordId: session.userId,
    reason,
  });

  sessions.clearSession('attendance:add', interaction.user.id);

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Attendance Added',
      description: 'Added <@' + session.userId + '> to event `' + session.eventId + '`.',
      fields: [{ name: 'Reason', value: reason, inline: false }],
    })],
  });
}
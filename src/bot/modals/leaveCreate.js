import { MessageFlags } from 'discord.js';
import * as leaveService from '../../services/leave.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed } from '../embedBuilders.js';

export const customId = 'modal:leave-create';
export const meta = {};

export async function execute(interaction) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) throw new AuthorizationError('You must be registered with the bot.');
  const ok = await permissionService.hasPermission(user._id, 'leave.create');
  if (!ok) throw new AuthorizationError('You do not have permission to request leave.');

  const startRaw = interaction.fields.getTextInputValue('startAt').trim();
  const endRaw = interaction.fields.getTextInputValue('endAt').trim();
  const reason = interaction.fields.getTextInputValue('reason').trim();

  const startAt = parseDate(startRaw, 'Start date');
  const endAt = parseDate(endRaw, 'End date');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const leave = await leaveService.createLeaveRequest(interaction.user.id, {
    startAt,
    endAt,
    reason,
  });

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Leave Request Submitted',
      description: 'Your request has been submitted for review.',
      fields: [
        {
          name: 'Period',
          value: '<t:' + Math.floor(startAt.getTime() / 1000) + ':d> → <t:' +
                 Math.floor(endAt.getTime() / 1000) + ':d>',
          inline: false,
        },
        { name: 'Reason', value: reason, inline: false },
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
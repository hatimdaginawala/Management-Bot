import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import * as leaveService from '../../services/leave.service.js';
import * as sessions from '../sessions.js';
import { successEmbed, COLORS } from '../embedBuilders.js';
import { dmLeaveUser } from '../utils/leaveDm.js';
import { formatDateRange } from '../utils/format.js';

export const customId = [
  'leave:approve:request',
  'leave:reject:request',
  'leave:end:request',
  'leave:self:cancel',
];
export const meta = {};

export async function execute(interaction) {
  const kind = interaction.customId.split(':')[1];
  const leaveId = interaction.values[0];

  if (kind === 'self') {
    await leaveService.cancelLeave(interaction.user.id, leaveId, {
      reason: 'Cancelled by requester',
    });
    return interaction.update({
      embeds: [successEmbed({
        title: 'Leave Cancelled',
        description: 'Your pending leave has been cancelled.',
      })],
      components: [],
    });
  }

  sessions.startSession('leave:' + kind, interaction.user.id, { leaveId });

  if (kind === 'approve') {
    const result = await leaveService.approveLeave(interaction.user.id, leaveId);
    sessions.clearSession('leave:approve', interaction.user.id);

    const leave = result.leave;
    const period = formatDateRange(leave.startAt, leave.endAt);

    await dmLeaveUser(interaction.client, leave, {
      title: 'Leave Approved',
      color: COLORS.SUCCESS,
      actorId: interaction.user.id,
      actorLabel: 'Approved By',
      extraLine: 'Your leave has been approved. You are exempt from weekly quota for this period.',
    });

    return interaction.update({
      embeds: [successEmbed({
        title: result.alreadyApproved ? 'Already Approved' : 'Leave Approved',
        description: '<@' + leave.discordId + '> is now on approved leave.',
        fields: [
          { name: 'Period', value: period, inline: false },
        ],
      })],
      components: [],
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('modal:leave-' + kind)
    .setTitle(kind === 'reject' ? 'Reject Leave' : 'End Leave');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel(kind === 'reject' ? 'Reason for rejection' : 'Reason (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(kind === 'reject')
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}
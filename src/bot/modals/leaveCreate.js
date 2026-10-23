// src/bot/modals/leaveCreate.js

import {
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import * as leaveService from '../../services/leave.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import * as settingsService from '../../services/settings.service.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed, infoEmbed, errorEmbed, COLORS } from '../embedBuilders.js';
import { formatDateRange } from '../utils/format.js';
import logger from '../../config/logger.js';

export const customId = 'modal:leave-create';
export const meta = {};

export async function execute(interaction) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You must be registered with the bot.');
  const ok = await permissionService.hasPermission(user.id, 'leave.create');
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

  // Notify the user
  await interaction.editReply({
    embeds: [successEmbed({
      title: 'Leave Request Submitted',
      description: 'Your request has been submitted for review.',
      fields: [
        { name: 'Period', value: formatDateRange(startAt, endAt), inline: false },
        { name: 'Reason', value: reason, inline: false },
      ],
    })],
  });

  // Post to the approval channel
  const settings = await settingsService.getSettings();
  const approvalChannelId = settings?.channels?.leaveApprovalChannelId;

  if (!approvalChannelId) {
    logger.warn({ leaveId: leave.id }, 'Leave approval channel not configured — skipping post');
    return;
  }

  try {
    const channel = await interaction.client.channels.fetch(approvalChannelId);
    if (!channel?.isTextBased?.()) throw new Error('Approval channel not text-based');

    const startTs = Math.floor(startAt.getTime() / 1000);
    const endTs = Math.floor(endAt.getTime() / 1000);
    const submittedTs = Math.floor(Date.now() / 1000);

    const reviewEmbed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('Leave Request Pending Review')
      .setDescription(
        '<@' + interaction.user.id + '> submitted a leave request on <t:' + submittedTs + ':f>.'
      )
      .addFields(
        { name: 'Period', value: '<t:' + startTs + ':d> → <t:' + endTs + ':d>', inline: false },
        { name: 'Reason', value: reason, inline: false },
      )
      .setTimestamp(new Date());

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('leave:approve:' + leave.id)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('leave:reject:' + leave.id)
        .setLabel('Reject')
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [reviewEmbed], components: [row] });
  } catch (err) {
    logger.error(
      { err: err.message, channelId: approvalChannelId, leaveId: leave.id },
      'Failed to post leave approval message'
    );
  }
}

function parseDate(raw, label) {
  const d = new Date(raw + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(label + ' must be a valid YYYY-MM-DD date.');
  }
  return d;
}
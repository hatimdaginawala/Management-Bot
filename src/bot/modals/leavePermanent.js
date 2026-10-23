// src/bot/modals/leavePermanent.js

import {
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import * as removalRequestService from '../../services/removalRequest.service.js';
import * as settingsService from '../../services/settings.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed, infoEmbed, COLORS } from '../embedBuilders.js';
import logger from '../../config/logger.js';

export const customId = 'modal:leave-permanent';
export const meta = {};

export async function execute(interaction) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You must be registered with the bot.');
  const ok = await permissionService.hasPermission(user.id, 'leave.create');
  if (!ok) throw new AuthorizationError('You do not have permission to request leave.');

  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (reason.length < 3) {
    throw new ValidationError('Reason must be at least 3 characters.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let request;
  try {
    request = await removalRequestService.createVoluntary(interaction.user.id, {
      reason,
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [infoEmbed({
        title: 'Could Not Submit',
        description: err.isOperational ? err.message : 'Something went wrong. Please try again.',
      })],
    });
  }

  // Reply to user
  await interaction.editReply({
    embeds: [successEmbed({
      title: 'Permanent Leave Requested',
      description:
        'Your permanent leave request has been submitted for High Command review. ' +
        'If approved, you will be removed from the group and all your internal roles will be revoked. ' +
        'Your historical records will be preserved.',
      fields: [{ name: 'Reason', value: reason, inline: false }],
    })],
  });

  // Post to the leave approval channel
  const settings = await settingsService.getSettings();
  const approvalChannelId = settings?.channels?.leaveApprovalChannelId;

  if (!approvalChannelId) {
    logger.warn({ requestId: request.id }, 'Leave approval channel not configured — skipping post');
    return;
  }

  try {
    const channel = await interaction.client.channels.fetch(approvalChannelId);
    if (!channel?.isTextBased?.()) throw new Error('Leave approval channel not text-based');

    const ts = Math.floor(Date.now() / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('Permanent Leave Request')
      .setDescription(
        '<@' + interaction.user.id + '> has requested permanent leave from the group on <t:' + ts + ':f>.'
      )
      .addFields(
        { name: 'Reason', value: reason, inline: false },
        { name: 'Effect if Approved', value: 'User will be marked LEFT_ROBLOX_GROUP, all internal roles removed, all active strikes cancelled, and quota category set to NONE.', inline: false },
      )
      .setTimestamp(new Date());

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('leave:approve:' + request.id)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('leave:reject:' + request.id)
        .setLabel('Reject')
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    logger.error(
      { err: err.message, channelId: approvalChannelId, requestId: request.id },
      'Failed to post permanent leave approval message'
    );
  }
}
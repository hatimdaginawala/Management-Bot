// src/bot/modals/memberRemove.js

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
import * as sessions from '../sessions.js';
import logger from '../../config/logger.js';

export const customId = 'modal:member-remove';
export const meta = {};

export async function execute(interaction) {
  const actor = await userRepo.findByDiscordId(interaction.user.id);
  if (!actor) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(actor.id, 'users.manage');
  if (!ok) throw new AuthorizationError('You do not have permission to remove members.');

  const session = sessions.getSession('member:remove', interaction.user.id);
  if (!session || !session.targetDiscordId) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Session Expired',
        description: 'Please run `/members` → Remove Member again.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const targetDiscordId = session.targetDiscordId;
  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (reason.length < 3) {
    throw new ValidationError('Reason must be at least 3 characters.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let request;
  try {
    request = await removalRequestService.createManual(interaction.user.id, {
      targetDiscordId,
      description: reason,
    });
  } catch (err) {
    sessions.clearSession('member:remove', interaction.user.id);
    return interaction.editReply({
      embeds: [infoEmbed({
        title: 'Could Not Create Removal',
        description: err.isOperational ? err.message : 'Something went wrong. Please try again.',
      })],
    });
  }

  sessions.clearSession('member:remove', interaction.user.id);

  // Reply to admin
  await interaction.editReply({
    embeds: [successEmbed({
      title: 'Removal Request Created',
      description:
        'A removal request for <@' + targetDiscordId + '> has been created and is pending High Command approval.',
      fields: [
        { name: 'Reason', value: reason, inline: false },
      ],
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
      .setTitle('Admin Removal Request')
      .setDescription(
        '<@' + interaction.user.id + '> has requested removal of <@' + targetDiscordId + '> on <t:' + ts + ':f>.'
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
      'Failed to post member removal approval message'
    );
  }
}
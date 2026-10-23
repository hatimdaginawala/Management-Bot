// src/bot/modals/leavePermanentReject.js

import { MessageFlags, EmbedBuilder } from 'discord.js';
import * as removalRequestService from '../../services/removalRequest.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed, COLORS } from '../embedBuilders.js';
import { sendUserDm } from '../utils/userDm.js';
import logger from '../../config/logger.js';

export const customId = 'modal:leave-permanent-reject:*';
export const meta = {};

export async function execute(interaction) {
  const requestId = extractRequestId(interaction.customId);
  if (!requestId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Error', description: 'Malformed interaction.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'leave.reject');
  if (!ok) throw new AuthorizationError('You do not have permission to reject leave requests.');

  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (reason.length < 3) {
    throw new ValidationError('Reason must be at least 3 characters.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let request;
  try {
    request = await removalRequestService.dismissRemoval(
      interaction.user.id,
      requestId,
      { reason }
    );
  } catch (err) {
    return interaction.editReply({
      embeds: [errorEmbed({
        title: 'Could Not Reject',
        description: err.isOperational ? err.message : 'Something went wrong. Please try again.',
      })],
    });
  }

  // Update the approval-channel embed
  try {
    const originalEmbed = interaction.message?.embeds?.[0];
    if (originalEmbed) {
      const updated = EmbedBuilder.from(originalEmbed)
        .setColor(COLORS.ERROR)
        .setTitle('Permanent Leave Rejected')
        .addFields(
          { name: 'Rejected By', value: '<@' + interaction.user.id + '>', inline: true },
          { name: 'Reason', value: reason, inline: false }
        );
      await interaction.message.edit({ embeds: [updated], components: [] });
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Could not edit permanent leave approval message');
  }

  // DM the requester
  if (request?.discord_id) {
    await sendUserDm(interaction.client, {
      discordId: request.discord_id,
      title: 'Permanent Leave Rejected',
      color: COLORS.ERROR,
      description:
        'Your request to leave the group permanently was rejected. ' +
        'You remain an active member. Contact High Command if you have questions.',
      fields: [
        { name: 'Reason', value: reason, inline: false },
        { name: 'Reviewed By', value: '<@' + interaction.user.id + '>', inline: true },
      ],
    });
  }

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Permanent Leave Rejected',
      description: 'The permanent leave request has been dismissed.',
      fields: [{ name: 'Reason', value: reason, inline: false }],
    })],
  });
}

function extractRequestId(customId) {
  const m = /^modal:leave-permanent-reject:(\d+)$/.exec(customId);
  return m ? m[1] : null;
}
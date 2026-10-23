// src/bot/buttons/leaveDecision.js

import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import * as leaveService from '../../services/leave.service.js';
import * as removalRequestService from '../../services/removalRequest.service.js';
import * as removalRepo from '../../db/repositories/removalRequest.repository.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed, COLORS } from '../embedBuilders.js';
import logger from '../../config/logger.js';

export const customId = ['leave:approve:*', 'leave:reject:*'];
export const meta = {};

export async function execute(interaction) {
  const parsed = parseAction(interaction.customId);
  if (!parsed) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Error', description: 'Malformed interaction.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (parsed.kind === 'approve') return handleApprove(interaction, parsed.id);
  if (parsed.kind === 'reject') return handleReject(interaction, parsed.id);
}

async function handleApprove(interaction, id) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'leave.approve');
  if (!ok) throw new AuthorizationError('You do not have permission to approve.');

  // Is this a removal_request (voluntary departure) or a leave?
  const removal = await removalRepo.findById(id).catch(() => null);

  if (removal) {
    // It's a permanent leave / admin removal
    const result = await removalRequestService.approveRemoval(
      interaction.user.id,
      id,
      { reason: null, effectiveAt: new Date(), client: interaction.client }
    );

    try {
      const originalEmbed = interaction.message?.embeds?.[0];
      if (originalEmbed) {
        const updated = EmbedBuilder.from(originalEmbed)
          .setColor(COLORS.SUCCESS)
          .setTitle('Permanent Leave Approved')
          .addFields({ name: 'Approved By', value: '<@' + interaction.user.id + '>' });
        await interaction.message.edit({ embeds: [updated], components: [] });
      }
    } catch {}

    // Apply the removal immediately (since it's voluntary, effective now)
    await removalRequestService.applyRemoval(id, { actorId: interaction.user.id });

    return interaction.reply({
      embeds: [successEmbed({
        title: 'Permanent Leave Applied',
        description: '<@' + removal.discord_id + '> has been removed from the group. Roles revoked, strikes cancelled.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  // It's a temporary leave
  const result = await leaveService.approveLeave(interaction.user.id, id, {
    client: interaction.client,
  });

  try {
    const originalEmbed = interaction.message?.embeds?.[0];
    if (originalEmbed) {
      const updated = EmbedBuilder.from(originalEmbed)
        .setColor(COLORS.SUCCESS)
        .setTitle('Leave Approved')
        .addFields({ name: 'Approved By', value: '<@' + interaction.user.id + '>' });
      await interaction.message.edit({ embeds: [updated], components: [] });
    }
  } catch {}

  return interaction.reply({
    embeds: [successEmbed({
      title: result.alreadyApproved ? 'Already Approved' : 'Leave Approved',
      description: 'Leave for <@' + result.leave.discord_id + '> has been approved.',
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleReject(interaction, id) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'leave.reject');
  if (!ok) throw new AuthorizationError('You do not have permission to reject.');

  const removal = await removalRepo.findById(id).catch(() => null);
  const customModalId = removal
    ? 'modal:leave-permanent-reject:' + id
    : 'modal:leave-reject:' + id;

  const modal = new ModalBuilder()
    .setCustomId(customModalId)
    .setTitle(removal ? 'Reject Permanent Leave' : 'Reject Leave');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for rejection')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}

function parseAction(customId) {
  const m = /^leave:(approve|reject):(\d+)$/.exec(customId);
  return m ? { kind: m[1], id: m[2] } : null;
}
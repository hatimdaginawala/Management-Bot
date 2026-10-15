import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import * as verificationService from '../../services/verification.service.js';
import * as verificationRepo from '../../db/repositories/verification.repository.js';
import { successEmbed, errorEmbed, COLORS } from '../embedBuilders.js';
import logger from '../../config/logger.js';

export const customId = 'link:verify:*';
export const meta = {};

export async function execute(interaction) {
  const verificationId = extractVerificationId(interaction.customId);
  if (!verificationId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Error', description: 'Malformed interaction.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  // 1. Load the verification this button refers to.
  const verification = await verificationRepo.findById(verificationId);
  if (!verification) {
    return interaction.update({
      embeds: [errorEmbed({
        title: 'Verification Not Found',
        description: 'This verification no longer exists. Run `/link` again.',
      })],
      components: [],
    });
  }

  // 2. Must belong to the user who clicked.
  if (verification.discord_id !== interaction.user.id) {
    return interaction.reply({
      embeds: [errorEmbed({
        title: 'Not Your Verification',
        description: 'This verification button belongs to someone else.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  // 3. Must still be PENDING. If already VERIFIED, show a friendly message.
  if (verification.status !== 'PENDING') {
    if (verification.status === 'VERIFIED') {
      return interaction.update({
        embeds: [successEmbed({
          title: 'Already Verified',
          description: 'You are already linked. No action needed.',
        })],
        components: [],
      });
    }
    return interaction.update({
      embeds: [errorEmbed({
        title: 'Verification ' + verification.status,
        description: 'This verification is no longer active. Run `/link` again.',
      })],
      components: [],
    });
  }

  // 4. Defer the update so we have time for the Roblox API call.
  await interaction.deferUpdate();

  try {
    // 5. Complete the verification. This performs the whole flow:
    //    profile fetch -> code match -> link user -> mark VERIFIED.
    const { user, robloxUser } = await verificationService.completeVerification(
      interaction.user.id
    );

    const successEmbed_ = successEmbed({
      title: 'Account Verified',
      description: 'Your Discord account is now linked to **' + robloxUser.name + '**.',
      fields: [
        { name: 'Roblox ID', value: '`' + robloxUser.id + '`', inline: true },
        { name: 'Linked At', value: '<t:' + Math.floor(Date.now() / 1000) + ':R>', inline: true },
      ],
    });

    // Update the ephemeral reply to remove the button and show success.
    await interaction.editReply({
      embeds: [successEmbed_],
      components: [],
    });

    // Also try to DM the success message.
    try {
      await interaction.user.send({ embeds: [successEmbed_] });
    } catch {
      // ignore
    }

    logger.info(
      { discordId: interaction.user.id, robloxId: robloxUser.id },
      'User verified via button'
    );
  } catch (err) {
    // The service throws AppError subclasses for all failure paths.
    // Show a clean error message on the same message, and re-enable the button
    // so the user can try again after fixing their About field.
    const isOperational = err.isOperational === true;
    const description = isOperational
      ? err.message
      : 'Something went wrong while verifying. Please try again in a moment.';

    logger.warn(
      { err: err.message, discordId: interaction.user.id, code: err.code },
      'Verification button click failed'
    );

    const retryRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('link:verify:' + verificationId)
        .setLabel('Try Again')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({
      embeds: [errorEmbed({
        title: 'Verification Failed',
        description,
        fields: [
          { name: 'Tip', value: 'Make sure your About section is **public** and you saved your profile.', inline: false },
        ],
      })],
      components: [retryRow],
    });
  }
}

function extractVerificationId(customId) {
  const m = /^link:verify:(\d+)$/.exec(customId);
  return m ? m[1] : null;
}
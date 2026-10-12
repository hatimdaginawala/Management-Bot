import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import * as verificationService from '../../../services/verification.service.js';
import { successEmbed } from '../../embedBuilders.js';

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Complete Roblox linking by verifying your profile About field.')
  .toJSON();

export const meta = {
  cooldownSeconds: 5,
};

export async function execute(interaction) {
  const { robloxUser, verification } =
    await verificationService.completeVerification(interaction.user.id);

  const linkedAt = verification.verified_at
    ? new Date(verification.verified_at)
    : new Date();

  const embed = successEmbed({
    title: 'Account Verified',
    description: 'Your Discord account is now linked to **' + robloxUser.name + '**.',
    fields: [
      { name: 'Roblox ID', value: '`' + robloxUser.id + '`', inline: true },
      {
        name: 'Linked At',
        value: '<t:' + Math.floor(linkedAt.getTime() / 1000) + ':R>',
        inline: true,
      },
    ],
  });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

  try {
    await interaction.user.send({ embeds: [embed] });
  } catch {
    // ignore
  }
}
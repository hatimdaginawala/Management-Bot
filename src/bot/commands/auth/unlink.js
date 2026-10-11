import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import * as verificationService from '../../../services/verification.service.js';
import { warningEmbed } from '../../embedBuilders.js';

export const data = new SlashCommandBuilder()
  .setName('unlink')
  .setDescription('Unlink your Discord account from your Roblox account.')
  .toJSON();

export const meta = {
  cooldownSeconds: 30,
};

export async function execute(interaction) {
  const user = await verificationService.unlinkSelf(interaction.user.id);

  const embed = warningEmbed({
    title: 'Account Unlinked',
    description:
      'Your Discord account is no longer linked to a Roblox account. ' +
      'You can re-link after 7 days (see below).',
    fields: [
      {
        name: 'Cooldown',
        value:
          'You can run `/link` again after 7 days. ' +
          'This prevents account trading.',
        inline: false,
      },
    ],
  });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
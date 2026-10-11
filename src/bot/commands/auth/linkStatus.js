import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import * as verificationService from '../../../services/verification.service.js';
import { infoEmbed, warningEmbed, successEmbed } from '../../embedBuilders.js';

export const data = new SlashCommandBuilder()
  .setName('link-status')
  .setDescription('Show the current link status of your Discord account.')
  .toJSON();

export const meta = {
  cooldownSeconds: 5,
};

export async function execute(interaction) {
  const { user, pending } = await verificationService.getLinkStatus(interaction.user.id);

  // Case 1: no User doc at all → user hasn't interacted with the bot yet.
  if (!user) {
    const embed = warningEmbed({
      title: 'Not Linked',
      description:
        'Your Discord account is not registered with the bot yet. ' +
        'Run `/link <roblox_username>` to begin.',
    });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // Case 2: User exists but no Roblox identity.
  if (!user.robloxId) {
    if (pending) {
      const expiresAt = new Date(pending.expiresAt);
      const unix = Math.floor(expiresAt.getTime() / 1000);
      const embed = infoEmbed({
        title: 'Verification Pending',
        description:
          'You have a pending verification. Paste the code in your Roblox ' +
          'About section and run `/verify`.',
        fields: [
          { name: 'Roblox Username', value: `\`${pending.robloxUsername}\``, inline: true },
          { name: 'Expires', value: `<t:${unix}:R>`, inline: true },
        ],
      });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const embed = warningEmbed({
      title: 'Not Linked',
      description: 'Your account is not linked to a Roblox account.',
      fields: [
        { name: 'Next Step', value: 'Run `/link <roblox_username>` to begin.', inline: false },
      ],
    });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // Case 3: fully linked.
  const embed = successEmbed({
    title: 'Account Linked',
    description: 'Your Discord account is linked to a Roblox account.',
    fields: [
      { name: 'Roblox Username', value: `\`${user.robloxUsername ?? '—'}\``, inline: true },
      { name: 'Roblox ID', value: `\`${user.robloxId}\``, inline: true },
      { name: 'Status', value: `\`${user.status}\``, inline: true },
    ],
  });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
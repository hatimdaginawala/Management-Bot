import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import * as verificationService from '../../../services/verification.service.js';
import { successEmbed } from '../../embedBuilders.js';
import logger from '../../../config/logger.js';

export const data = new SlashCommandBuilder()
  .setName('link-manual')
  .setDescription('Force-link a Discord user to a Roblox account (High Command+).')
  .addUserOption((opt) =>
    opt
      .setName('user')
      .setDescription('The Discord user to link')
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName('roblox_username')
      .setDescription('The exact Roblox username to link')
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(20)
  )
  .addStringOption((opt) =>
    opt
      .setName('reason')
      .setDescription('Why this manual link is necessary')
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(500)
  )
  .toJSON();

export const meta = {
  permission: 'verification.manualLink',
};

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  const robloxUsername = interaction.options.getString('roblox_username', true);
  const reason = interaction.options.getString('reason', true);

  const { user, robloxUser } = await verificationService.manualLink({
    actorId: interaction.user.id,
    targetDiscordId: targetUser.id,
    robloxUsernameRaw: robloxUsername,
    reason,
  });

  const embed = successEmbed({
    title: 'Manual Link Complete',
    description: `<@${targetUser.id}> is now linked to **${robloxUser.name}**.`,
    fields: [
      { name: 'Roblox ID', value: `\`${robloxUser.id}\``, inline: true },
      { name: 'Reason', value: reason, inline: false },
    ],
  });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

  // Notify the target (best-effort).
  try {
    const dmEmbed = successEmbed({
      title: 'Account Linked',
      description:
        `Your Discord account was linked to **${robloxUser.name}** by an administrator.`,
      fields: [{ name: 'Reason', value: reason, inline: false }],
    });
    await targetUser.send({ embeds: [dmEmbed] });
  } catch (err) {
    logger.debug(
      { targetDiscordId: targetUser.id, err: err.message },
      'Could not DM manual-link notification'
    );
  }
}
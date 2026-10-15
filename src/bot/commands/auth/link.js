import {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import * as verificationService from '../../../services/verification.service.js';
import { infoEmbed } from '../../embedBuilders.js';
import logger from '../../../config/logger.js';

export const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link your Discord account to a Roblox account.')
  .addStringOption((opt) =>
    opt
      .setName('roblox_username')
      .setDescription('Your exact Roblox username')
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(20)
  )
  .toJSON();

export const meta = {
  cooldownSeconds: 30,
};

export async function execute(interaction) {
  const username = interaction.options.getString('roblox_username', true);

  const { verification, robloxUser } = await verificationService.startVerification(
    interaction.user.id,
    username
  );

  const instructions = [
    '**Hi ' + interaction.user.username + '!** Here is how to finish linking:',
    '',
    '**1.** Open your Roblox profile:',
    '    https://www.roblox.com/users/' + robloxUser.id + '/profile',
    '',
    '**2.** Click **Edit Profile** and paste this code somewhere in your **About** section:',
    '',
    '      `' + verification.code + '`',
    '',
    '**3.** Save your profile, then click the button below.',
    '',
    '**This code expires in 30 minutes.** If it expires, run `/link` again.',
  ].join('\n');

  const embed = infoEmbed({
    title: 'Roblox Account Linking',
    description: instructions,
    fields: [
      {
        name: 'Matched Roblox Account',
        value: '**' + robloxUser.name + '** (ID: `' + robloxUser.id + '`)',
        inline: false,
      },
    ],
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('link:verify:' + verification.id)
      .setLabel('Verify My Account')
      .setStyle(ButtonStyle.Success)

  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  try {
    await interaction.user.send({ embeds: [embed] });
  } catch (err) {
    logger.debug(
      { discordId: interaction.user.id, err: err.message },
      'Could not DM verification code'
    );
  }
}
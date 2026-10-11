import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { infoEmbed } from '../embedBuilders.js';

export const data = new SlashCommandBuilder()
  .setName('_ping')
  .setDescription('Check that the bot is responding.')
  .toJSON();

export const meta = {
  // No permission required — anyone can ping.
};

export async function execute(interaction, { user }) {
  const latencyMs = Date.now() - interaction.createdTimestamp;

  const embed = infoEmbed({
    title: 'Pong',
    description: 'The bot is online and responding.',
    fields: [
      { name: 'Roundtrip', value: `${latencyMs} ms`, inline: true },
      {
        name: 'Linked',
        value: user ? `Yes (${user.discordId})` : 'No',
        inline: true,
      },
    ],
  });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as sessions from '../sessions.js';

export const customId = 'notice:extend:notice';
export const meta = {};

export async function execute(interaction) {
  const noticeId = interaction.values[0];
  sessions.startSession('notice:extend', interaction.user.id, { noticeId });

  const modal = new ModalBuilder()
    .setCustomId('modal:notice-extend')
    .setTitle('Request Notice Extension');

  const endInput = new TextInputBuilder()
    .setCustomId('newEndAt')
    .setLabel('New end date (YYYY-MM-DD)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10);

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for extension')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(endInput),
    new ActionRowBuilder().addComponents(reasonInput)
  );

  return interaction.showModal(modal);
}
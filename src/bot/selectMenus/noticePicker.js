import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as sessions from '../sessions.js';

export const customId = 'notice:cancel:notice';
export const meta = {};

export async function execute(interaction) {
  const noticeId = interaction.values[0];
  sessions.startSession('notice:cancel', interaction.user.id, { noticeId });

  const modal = new ModalBuilder()
    .setCustomId('modal:notice-cancel')
    .setTitle('Cancel Notice');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for cancellation')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}
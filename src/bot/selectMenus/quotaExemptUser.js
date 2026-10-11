import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import * as sessions from '../sessions.js';

export const customId = 'quota:exempt:user';
export const meta = {};

export async function execute(interaction) {
  const selectedUserId = interaction.values[0];

  sessions.updateSession('quota:exempt', interaction.user.id, {
    userId: selectedUserId,
    step: 'reason',
  });

  const modal = new ModalBuilder()
    .setCustomId('modal:quota-exempt-reason')
    .setTitle('Grant Quota Exemption');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason')
    .setPlaceholder('Why this exemption is being granted')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}
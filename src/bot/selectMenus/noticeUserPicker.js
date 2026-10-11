import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as sessions from '../sessions.js';

export const customId = 'notice:create:user';
export const meta = {};

export async function execute(interaction) {
  const selectedUserId = interaction.values[0];

  sessions.updateSession('notice:create', interaction.user.id, {
    userId: selectedUserId,
    step: 'reason',
  });

  const modal = new ModalBuilder()
    .setCustomId('modal:notice-create')
    .setTitle('Create Notice');

  const typeInput = new TextInputBuilder()
    .setCustomId('type')
    .setLabel('Type')
    .setPlaceholder('INACTIVITY | WARNING | ADMINISTRATIVE | OTHER')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  const endInput = new TextInputBuilder()
    .setCustomId('endAt')
    .setLabel('End date (YYYY-MM-DD, optional)')
    .setPlaceholder('Leave empty for open-ended')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  const exemptInput = new TextInputBuilder()
    .setCustomId('grantsQuotaExemption')
    .setLabel('Grant quota exemption? (yes/no, optional)')
    .setPlaceholder('Defaults to yes for INACTIVITY, no otherwise')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(3);

  modal.addComponents(
    new ActionRowBuilder().addComponents(typeInput),
    new ActionRowBuilder().addComponents(reasonInput),
    new ActionRowBuilder().addComponents(endInput),
    new ActionRowBuilder().addComponents(exemptInput)
  );

  return interaction.showModal(modal);
}
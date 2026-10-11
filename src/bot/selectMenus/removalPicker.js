import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as sessions from '../sessions.js';

export const customId = ['removal:approve:request', 'removal:dismiss:request'];
export const meta = {};

export async function execute(interaction) {
  const kind = interaction.customId.split(':')[1]; // approve | dismiss
  const requestId = interaction.values[0];

  sessions.startSession('removal:' + kind, interaction.user.id, { requestId });

  const modal = new ModalBuilder()
    .setCustomId('modal:removal-' + kind)
    .setTitle(kind === 'approve' ? 'Approve Removal' : 'Dismiss Removal');

  if (kind === 'approve') {
    const dateInput = new TextInputBuilder()
      .setCustomId('effectiveAt')
      .setLabel('Effective date (YYYY-MM-DD)')
      .setPlaceholder('Leave empty for default (3 days from now)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(10);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Reason')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder().addComponents(dateInput),
      new ActionRowBuilder().addComponents(reasonInput)
    );
  } else {
    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Reason')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  }

  return interaction.showModal(modal);
}
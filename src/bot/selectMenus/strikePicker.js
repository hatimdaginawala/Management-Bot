import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as sessions from '../sessions.js';

export const customId = ['strike:remove:strike', 'strike:recover:strike'];
export const meta = {};

export async function execute(interaction) {
  const kind = interaction.customId.split(':')[1]; // remove | recover
  const strikeId = interaction.values[0];

  sessions.updateSession('strike:' + kind, interaction.user.id, { strikeId });

  const modal = new ModalBuilder()
    .setCustomId('modal:strike-' + kind)
    .setTitle(kind === 'remove' ? 'Remove Strike' : 'Recover Strike');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}
import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import * as sessions from '../sessions.js';

export const customId = ['attendance:add:event', 'attendance:remove:event'];
export const meta = {};

export async function execute(interaction) {
  const isAdd = interaction.customId === 'attendance:add:event';
  const kind = isAdd ? 'attendance:add' : 'attendance:remove';

  const selectedEventId = interaction.values[0];

  const session = sessions.updateSession(kind, interaction.user.id, {
    eventId: selectedEventId,
    step: 'reason',
  });

  if (!session || !session.userId) {
    return interaction.reply({
      content: 'Your session expired. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(isAdd ? 'modal:attendance-add' : 'modal:attendance-remove')
    .setTitle((isAdd ? 'Add' : 'Remove') + ' Attendance');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason')
    .setPlaceholder('Why this correction is needed')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}
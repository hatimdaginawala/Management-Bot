// src/bot/selectMenus/memberRemoveUser.js

import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as sessions from '../sessions.js';

export const customId = 'member:remove:user';
export const meta = {};

export async function execute(interaction) {
  const targetDiscordId = interaction.values[0];

  sessions.startSession('member:remove', interaction.user.id, {
    targetDiscordId,
  });

  const modal = new ModalBuilder()
    .setCustomId('modal:member-remove')
    .setTitle('Remove Member');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for removal')
    .setPlaceholder('Explain why this member is being removed')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}
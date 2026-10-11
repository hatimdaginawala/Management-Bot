import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as strikeService from '../../services/strike.service.js';
import * as sessions from '../sessions.js';
import { infoEmbed } from '../embedBuilders.js';

export const customId = [
  'strike:issue:user',
  'strike:remove:user',
  'strike:recover:user',
];
export const meta = {};

export async function execute(interaction) {
  const kind = interaction.customId.split(':')[1]; // issue | remove | recover
  const selectedUserId = interaction.values[0];

  if (kind === 'issue') {
    sessions.startSession('strike:issue', interaction.user.id, { userId: selectedUserId });
    return openReasonModal(interaction, 'modal:strike-issue', 'Issue Strike');
  }

  // remove or recover — first need to show the strike picker
  const active = await strikeService.getActiveStrikes(selectedUserId);
  if (active.length === 0) {
    return interaction.update({
      embeds: [infoEmbed({
        title: 'No Active Strikes',
        description: '<@' + selectedUserId + '> has no active strikes.',
      })],
      components: [],
    });
  }

  sessions.startSession('strike:' + kind, interaction.user.id, { userId: selectedUserId });

  const options = active.slice(0, 25).map((s) => {
    const ts = Math.floor(new Date(s.issuedAt).getTime() / 1000);
    const period = s.quotaPeriodKey ? ' — ' + s.quotaPeriodKey : '';
    const label = s.type + period;
    const desc = '<t:' + ts + ':R> — ' + (s.reason || 'no reason');
    return {
      label: label.slice(0, 100),
      description: desc.slice(0, 100),
      value: String(s._id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('strike:' + kind + ':strike')
    .setPlaceholder('Select a strike')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.update({
    embeds: [infoEmbed({
      title: (kind === 'remove' ? 'Remove' : 'Recover') + ' Strike — Step 2 of 2',
      description: 'Selected user: <@' + selectedUserId + '>\n\nPick the strike to act on.',
    })],
    components: [row],
  });
}

function openReasonModal(interaction, customId, title) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title);

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
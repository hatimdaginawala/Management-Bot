import {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Event management commands.')
  .addSubcommand((sub) =>
    sub.setName('create').setDescription('Log a new event.')
  )
  .addSubcommand((sub) =>
    sub.setName('view').setDescription('View an event by selecting from a list.')
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('List events.')
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Filter by status')
          .addChoices(
            { name: 'Pending', value: 'PENDING' },
            { name: 'Approved', value: 'APPROVED' },
            { name: 'Rejected', value: 'REJECTED' },
            { name: 'Cancelled', value: 'CANCELLED' },
            { name: 'Any', value: 'ANY' }
          )
      )
      .addUserOption((o) => o.setName('host').setDescription('Filter by host'))
      .addStringOption((o) => o.setName('type').setDescription('Filter by event type'))
      .addIntegerOption((o) => o.setName('page').setDescription('Page number'))
  )
  .addSubcommand((sub) =>
    sub.setName('approve').setDescription('Approve a pending event.')
  )
  .addSubcommand((sub) =>
    sub.setName('reject').setDescription('Reject a pending event.')
  )
  .addSubcommand((sub) =>
    sub.setName('cancel').setDescription('Cancel an approved event.')
  )
    .addSubcommand((sub) =>
    sub
      .setName('stats')
      .setDescription('Event activity statistics.')
      .addStringOption((opt) =>
        opt
          .setName('type')
          .setDescription('Filter by event type (blank = all)')
          .setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('period')
          .setDescription('Comparison window')
          .addChoices(
            { name: 'Last 7 days', value: '7d' },
            { name: 'Last 30 days', value: '30d' },
            { name: 'Last 90 days', value: '90d' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName('types').setDescription('List available event types.')
  )
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'create':  return openCreateModal(interaction);
    case 'view':    return (await import('./view.js')).handleView(interaction);
    case 'list':    return (await import('./list.js')).handleList(interaction);
    case 'approve': return (await import('./approve.js')).handleApprove(interaction);
    case 'reject':  return (await import('./reject.js')).handleReject(interaction);
    case 'cancel':  return (await import('./cancel.js')).handleCancel(interaction);
    case 'types':   return (await import('./types.js')).handleTypes(interaction);
        case 'stats':   return (await import('./stats.js')).handleStats(interaction);
    default:
      throw new Error('Unknown subcommand: ' + sub);
  }
}

function openCreateModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal:event-create')
    .setTitle('Log New Event');

  const typeInput = new TextInputBuilder()
    .setCustomId('eventTypeKey')
    .setLabel('Event type')
    .setPlaceholder('patrol, ct, dt, raid, tryout, other')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const attendeesInput = new TextInputBuilder()
    .setCustomId('attendees')
    .setLabel('Attendees')
    .setPlaceholder('Discord IDs or Roblox usernames, comma-separated')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);

  const proofInput = new TextInputBuilder()
    .setCustomId('proofUrl')
    .setLabel('Proof URL')
    .setPlaceholder('https://...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(500);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes (optional)')
    .setPlaceholder('Any additional context')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(typeInput),
    new ActionRowBuilder().addComponents(attendeesInput),
    new ActionRowBuilder().addComponents(proofInput),
    new ActionRowBuilder().addComponents(notesInput)
  );

  return interaction.showModal(modal);
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'type') {
    const types = await (await import('../../../services/eventType.service.js')).listEventTypes();
    const q = String(focused.value || '').toLowerCase();
    const choices = types
      .filter((t) => t.key.includes(q) || t.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((t) => ({ name: t.name, value: t.key }));
    return interaction.respond(choices);
  }
  return interaction.respond([]);
}
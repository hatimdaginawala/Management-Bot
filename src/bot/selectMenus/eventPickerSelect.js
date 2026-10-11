import { MessageFlags } from 'discord.js';
import * as eventService from '../../services/event.service.js';
import * as permissionService from '../../services/permission.service.js';
import { successEmbed, errorEmbed, infoEmbed } from '../embedBuilders.js';
import { AuthorizationError } from '../../utils/errors.js';
import { User } from '../../models/index.js';
import { formatEventSummary } from '../components/eventPicker.js';

export const customId = 'event-picker:*';
export const meta = {};

export async function execute(interaction) {
  const action = extractAction(interaction.customId);
  if (!action) return ephemeralError(interaction, 'Malformed picker.');

  const eventId = interaction.values[0];

  // Dispatch based on action.
  switch (action) {
    case 'view':    return handleView(interaction, eventId);
    case 'approve': return handleApprove(interaction, eventId);
    case 'reject':  return handleReject(interaction, eventId);
    case 'cancel':  return handleCancel(interaction, eventId);
    default:
      return ephemeralError(interaction, 'Unknown action: ' + action);
  }
}

// ---------- view ----------

async function handleView(interaction, eventId) {
  await requirePermission(interaction, 'events.view');
  const event = await eventService.getEvent(eventId);

  await interaction.update({
    embeds: [infoEmbed({
      title: 'Event Details',
      description: formatEventSummary(event),
      fields: [
        { name: 'Proof', value: event.proofUrl, inline: false },
        ...(event.notes ? [{ name: 'Notes', value: event.notes, inline: false }] : []),
      ],
    })],
    components: [],
  });
}

// ---------- approve ----------

async function handleApprove(interaction, eventId) {
  await requirePermission(interaction, 'events.approve');
  const result = await eventService.approveEvent(interaction.user.id, eventId);

  await interaction.update({
    embeds: [successEmbed({
      title: result.alreadyApproved ? 'Already Approved' : 'Event Approved',
      description: formatEventSummary(result.event),
    })],
    components: [],
  });
}

// ---------- reject ----------

async function handleReject(interaction, eventId) {
  await requirePermission(interaction, 'events.reject');

  // Open the reason modal.
  const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } =
    await import('discord.js');

  const modal = new ModalBuilder()
    .setCustomId('modal:event-reject:' + eventId)
    .setTitle('Reject Event');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for rejection')
    .setPlaceholder('Explain why this event is being rejected')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}

// ---------- cancel ----------

async function handleCancel(interaction, eventId) {
  await requirePermission(interaction, 'events.cancel');

  const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } =
    await import('discord.js');

  const modal = new ModalBuilder()
    .setCustomId('modal:event-cancel:' + eventId)
    .setTitle('Cancel Event');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}

// ---------- helpers ----------

function extractAction(customId) {
  const m = /^event-picker:(\w+)$/.exec(customId);
  return m ? m[1] : null;
}

async function requirePermission(interaction, key) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user._id, key);
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');
}

async function ephemeralError(interaction, msg) {
  const payload = {
    embeds: [errorEmbed({ title: 'Error', description: msg })],
    flags: MessageFlags.Ephemeral,
  };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}
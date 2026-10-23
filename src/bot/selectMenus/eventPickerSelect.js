import { MessageFlags } from 'discord.js';
import * as eventService from '../../services/event.service.js';
import * as attendanceService from '../../services/attendance.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { successEmbed, errorEmbed, infoEmbed, truncate } from '../embedBuilders.js';
import { AuthorizationError } from '../../utils/errors.js';
import { formatEventSummary } from '../components/eventPicker.js';

export const customId = 'event-picker:*';
export const meta = {};

export async function execute(interaction) {
  const action = extractAction(interaction.customId);
  if (!action) return ephemeralError(interaction, 'Malformed picker.');

  const eventId = interaction.values[0];

  switch (action) {
    case 'view':    return handleView(interaction, eventId);
    case 'approve': return handleApprove(interaction, eventId);
    case 'reject':  return handleReject(interaction, eventId);
    case 'cancel':  return handleCancel(interaction, eventId);
    default:        return ephemeralError(interaction, 'Unknown action: ' + action);
  }
}

async function handleView(interaction, eventId) {
  await requirePermission(interaction, 'events.view');
  const event = await eventService.getEvent(eventId);
  const attendanceCount = await attendanceService.countAttendanceForEvent(event.id);

  const statusEmoji = {
    PENDING: '🟡',
    APPROVED: '🟢',
    REJECTED: '🔴',
    CANCELLED: '⚫',
  }[event.status] || '⚪';

const fields = [
  { name: 'Status', value: statusEmoji + ' `' + event.status + '`', inline: true },
  { name: 'Type', value: '`' + event.event_type_key + '`', inline: true },
  { name: 'Host', value: '<@' + event.host_discord_id + '>', inline: true },
];

if (event.cohost_discord_id) {
  fields.push({ name: 'Co-host', value: '<@' + event.cohost_discord_id + '>', inline: true });
}

fields.push(
  { name: 'Attendees', value: String((event.attendeeEntries || []).length) + ' listed, ' + String(attendanceCount) + ' credited', inline: false },
  { name: 'Proof', value: '<' + event.proof_url + '>', inline: false }
);
  if (event.notes) {
    fields.push({ name: 'Notes', value: truncate(event.notes, 500), inline: false });
  }
  if (event.rejection_reason) {
    fields.push({ name: 'Rejection Reason', value: truncate(event.rejection_reason, 500), inline: false });
  }
  if (event.cancellation_reason) {
    fields.push({ name: 'Cancellation Reason', value: truncate(event.cancellation_reason, 500), inline: false });
  }

  const ts = Math.floor(new Date(event.created_at).getTime() / 1000);

  await interaction.update({
    embeds: [infoEmbed({
      title: 'Event Details',
      description: 'Created <t:' + ts + ':R>',
      fields,
    })],
    components: [],
  });
}

async function handleApprove(interaction, eventId) {
  await requirePermission(interaction, 'events.approve');
  const result = await eventService.approveEvent(interaction.user.id, eventId, {
    client: interaction.client,
  });

  await interaction.update({
    embeds: [successEmbed({
      title: result.alreadyApproved ? 'Already Approved' : 'Event Approved',
      description: formatEventSummary(result.event),
    })],
    components: [],
  });
}

async function handleReject(interaction, eventId) {
  await requirePermission(interaction, 'events.reject');

  const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = await import('discord.js');

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

async function handleCancel(interaction, eventId) {
  await requirePermission(interaction, 'events.cancel');

  const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = await import('discord.js');

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

function extractAction(customId) {
  const m = /^event-picker:(\w+)$/.exec(customId);
  return m ? m[1] : null;
}

async function requirePermission(interaction, key) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, key);
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
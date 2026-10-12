import { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import * as eventService from '../../services/event.service.js';
import * as settingsService from '../../services/settings.service.js';
import { successEmbed, infoEmbed, errorEmbed, COLORS } from '../embedBuilders.js';
import logger from '../../config/logger.js';

export const customId = 'modal:event-create';
export const meta = {
  permission: 'events.create',
};

export async function execute(interaction) {
  const eventTypeKey = interaction.fields.getTextInputValue('eventTypeKey').trim().toLowerCase();
  const attendeesRaw = interaction.fields.getTextInputValue('attendees').trim();
  const proofUrl = interaction.fields.getTextInputValue('proofUrl').trim();
  const notesRaw = interaction.fields.getTextInputValue('notes');
  const notes = notesRaw ? notesRaw.trim() : '';

  const attendees = parseAttendees(attendeesRaw);

  if (attendees.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'No Attendees', description: 'You must provide at least one attendee.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const event = await eventService.createEvent(interaction.user.id, {
    eventTypeKey,
    attendees,
    proofUrl,
    notes,
  });

  if (event.status === 'APPROVED') {
    return interaction.editReply({
      embeds: [successEmbed({
        title: 'Event Logged',
        description: 'Your event was recorded and approved automatically.',
        fields: [
          { name: 'Type', value: '`' + event.event_type_key + '`', inline: true },
          { name: 'Hosted By', value: '<@' + event.host_discord_id + '>', inline: true },
          { name: 'Attendees Credited', value: String(event.attendeeEntries.length), inline: true },
          { name: 'Logged', value: '<t:' + Math.floor(new Date(event.created_at).getTime() / 1000) + ':R>', inline: true },
          { name: 'Proof', value: '<' + event.proof_url + '>', inline: false },
        ],
      })],
    });
  }

  const settings = await settingsService.getSettings();
  const approvalChannelId = settings?.channels?.eventApprovalChannelId;

  if (!approvalChannelId) {
    return interaction.editReply({
      embeds: [infoEmbed({
        title: 'Event Submitted (Pending Review)',
        description:
          'Your event has been submitted for approval. ' +
          'However, the approval channel is not configured — ' +
          'please notify High Command to review it manually.',
      })],
    });
  }

  try {
    const channel = await interaction.client.channels.fetch(approvalChannelId);
    if (!channel?.isTextBased?.()) throw new Error('Approval channel not text-based');

    const ts = Math.floor(new Date(event.created_at).getTime() / 1000);
    const reviewEmbed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle('Event Pending Approval')
      .setDescription('<' + '@' + event.host_discord_id + '> submitted an event on <t:' + ts + ':f>.')
      .addFields(
        { name: 'Type', value: '`' + event.event_type_key + '`', inline: true },
        { name: 'Attendees', value: String(event.attendeeEntries.length), inline: true },
        { name: 'Logged', value: '<t:' + ts + ':R>', inline: true },
        { name: 'Proof', value: '<' + event.proof_url + '>', inline: false },
      )
      .setTimestamp(new Date());

    if (event.notes) reviewEmbed.addFields({ name: 'Notes', value: event.notes, inline: false });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('event:approve:' + event.id).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('event:reject:' + event.id).setLabel('Reject').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('event:details:' + event.id).setLabel('Details').setStyle(ButtonStyle.Secondary)
    );

    await channel.send({ embeds: [reviewEmbed], components: [row] });

    return interaction.editReply({
      embeds: [successEmbed({
        title: 'Event Submitted',
        description: 'Your event has been submitted for review. You will be notified once a decision is made.',
        fields: [
          { name: 'Type', value: '`' + event.event_type_key + '`', inline: true },
          { name: 'Logged', value: '<t:' + ts + ':R>', inline: true },
          { name: 'Approval Channel', value: '<#' + approvalChannelId + '>', inline: false },
        ],
      })],
    });
  } catch (err) {
    logger.error({ err: err.message, channelId: approvalChannelId }, 'Failed to post event approval message');
    return interaction.editReply({
      embeds: [infoEmbed({
        title: 'Event Submitted (Pending Review)',
        description:
          'Your event has been submitted for approval. ' +
          'The bot could not post it to the approval channel — ' +
          'please notify High Command manually.',
      })],
    });
  }
}

function parseAttendees(raw) {
  const parts = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];

  for (const part of parts) {
    const mention = /^<@!?(\d{15,25})>$/.exec(part);
    if (mention) {
      const id = mention[1];
      if (!seen.has(id)) { seen.add(id); out.push({ discordId: id }); }
      continue;
    }
    if (/^\d{15,25}$/.test(part)) {
      if (!seen.has(part)) { seen.add(part); out.push({ discordId: part }); }
      continue;
    }
    if (/^[A-Za-z0-9_]{3,20}$/.test(part)) {
      const key = 'rbx:' + part.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push({ robloxUsername: part }); }
    }
  }
  return out;
}
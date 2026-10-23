// src/bot/commands/event-create.js

import {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import * as eventService from '../../services/event.service.js';
import * as settingsService from '../../services/settings.service.js';
import { successEmbed, infoEmbed, errorEmbed, COLORS } from '../embedBuilders.js';
import { replyOrUpdate } from '../menus/render.js';
import { EVENT_TYPE_SEEDS } from '../../constants/eventTypes.js';
import logger from '../../config/logger.js';

export const data = new SlashCommandBuilder()
  .setName('event-create')
  .setDescription('Log a new event in one line.')
  .addStringOption((opt) =>
    opt
      .setName('type')
      .setDescription('Event type')
      .setRequired(true)
      .addChoices(
        ...EVENT_TYPE_SEEDS.map((t) => ({ name: t.name, value: t.key }))
      )
  )
  .addStringOption((opt) =>
    opt
      .setName('attendees')
      .setDescription('Discord mentions, Discord IDs, or Roblox usernames — comma or space separated')
      .setRequired(true)
      .setMaxLength(2000)
  )
  .addStringOption((opt) =>
    opt
      .setName('proofurl')
      .setDescription('Screenshot, video, or message link')
      .setRequired(true)
      .setMaxLength(500)
  )
  .addStringOption((opt) =>
    opt
      .setName('notes')
      .setDescription('Optional notes (wrap in quotes if using spaces)')
      .setRequired(false)
      .setMaxLength(1000)
  )
  .addUserOption((opt) =>
    opt
      .setName('cohost')
      .setDescription('Optional co-host (must be a Discord user)')
      .setRequired(false)
  )
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  const eventTypeKey = interaction.options.getString('type', true).trim().toLowerCase();
  const attendeesRaw = interaction.options.getString('attendees', true).trim();
  const proofUrl = interaction.options.getString('proofurl', true).trim();
  const notesRaw = interaction.options.getString('notes') ?? '';
  const notes = notesRaw.trim();
  const cohostUser = interaction.options.getUser('cohost');

  const attendees = parseAttendees(attendeesRaw);

  if (attendees.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [errorEmbed({
        title: 'No Attendees',
        description: 'You must provide at least one attendee.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (cohostUser && cohostUser.id === interaction.user.id) {
    return replyOrUpdate(interaction, {
      embeds: [errorEmbed({
        title: 'Invalid Co-host',
        description: 'You cannot be the co-host of your own event.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  let event;
  try {
    event = await eventService.createEvent(interaction.user.id, {
      eventTypeKey,
      attendees,
      cohost: cohostUser ? { discordId: cohostUser.id } : null,
      proofUrl,
      notes,
    });
  } catch (err) {
    const description = err.isOperational
      ? err.message
      : 'Something went wrong while creating the event. Please try again.';
    return interaction.editReply({
      embeds: [errorEmbed({ title: 'Could Not Log Event', description })],
    });
  }

  if (event.status === 'APPROVED') {
    const fields = [
      { name: 'Type', value: '`' + event.event_type_key + '`', inline: true },
      { name: 'Hosted By', value: '<@' + event.host_discord_id + '>', inline: true },
      { name: 'Attendees Credited', value: String(event.attendeeEntries.length), inline: true },
      { name: 'Logged', value: '<t:' + Math.floor(new Date(event.created_at).getTime() / 1000) + ':R>', inline: true },
      { name: 'Proof', value: '<' + event.proof_url + '>', inline: false },
    ];
    if (event.cohost_discord_id) {
      fields.push({ name: 'Co-host', value: '<@' + event.cohost_discord_id + '>', inline: true });
    }

    return interaction.editReply({
      embeds: [successEmbed({
        title: 'Event Logged',
        description: 'Your event was recorded and approved automatically.',
        fields,
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

    if (event.cohost_discord_id) {
      reviewEmbed.addFields({ name: 'Co-host', value: '<@' + event.cohost_discord_id + '>', inline: true });
    }

    if (event.notes) {
      reviewEmbed.addFields({ name: 'Notes', value: event.notes, inline: false });
    }

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
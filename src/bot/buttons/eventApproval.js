import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import * as eventService from '../../services/event.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as settingsService from '../../services/settings.service.js';
import { successEmbed, errorEmbed, infoEmbed, COLORS } from '../embedBuilders.js';
import { AuthorizationError } from '../../utils/errors.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import logger from '../../config/logger.js';

export const customId = ['event:approve:*', 'event:reject:*'];
export const meta = {};

export async function execute(interaction) {
  const action = parseAction(interaction.customId);
  if (!action) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Error', description: 'Malformed interaction.' })],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (action.kind === 'approve') return handleApprove(interaction, action.eventId);
  if (action.kind === 'reject') return handleReject(interaction, action.eventId);
}

async function handleApprove(interaction, eventId) {
  const perm = await checkPermission(interaction.user.id, 'events.approve');
  if (!perm) throw new AuthorizationError('You do not have permission to approve events.');

const { event, alreadyApproved } = await eventService.approveEvent(
  interaction.user.id,
  eventId,
  { client: interaction.client }
);
// dmHost call REMOVED — service handles it now

  try {
    const originalEmbed = interaction.message?.embeds?.[0];
    const updated = originalEmbed
      ? EmbedBuilder.from(originalEmbed).setColor(COLORS.SUCCESS).setTitle('Event Approved')
      : null;
    await interaction.message?.edit?.({
      embeds: updated ? [updated] : undefined,
      components: [],
    });
  } catch (err) {
    logger.debug({ err: err.message }, 'Could not edit approval message');
  }

  if (alreadyApproved) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'Already Approved', description: 'This event was already approved.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await dmHost(interaction.client, event, {
    title: 'Event Approved',
    color: COLORS.SUCCESS,
    approverId: interaction.user.id,
    extraLine: 'Your event has been approved. Attendance has been credited.',
  });

  const ts = Math.floor(new Date(event.created_at).getTime() / 1000);
  return interaction.reply({
    embeds: [successEmbed({
      title: 'Event Approved',
      description: 'Approved **' + event.event_type_key + '** hosted by <@' + event.host_discord_id + '> (logged <t:' + ts + ':R>).',
      fields: [
        { name: 'Attendees Credited', value: String(event.attendeeEntries.length), inline: true },
      ],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleReject(interaction, eventId) {
  const perm = await checkPermission(interaction.user.id, 'events.reject');
  if (!perm) throw new AuthorizationError('You do not have permission to reject events.');

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

export async function dmHost(client, event, {
  title,
  color,
  approverId = null,
  reason = null,
  extraLine = null,
} = {}) {
  try {
    const settings = await settingsService.getSettings();
    const dmEnabled = settings?.notifications?.dmAffectedUser ?? true;
    if (!dmEnabled) {
      logger.debug('DM to host skipped: notifications.dmAffectedUser is false');
      return;
    }

    const hostId = event?.host_discord_id;
    if (!hostId) {
      logger.debug('DM to host skipped: no host discordId');
      return;
    }

    const user = await client.users.fetch(hostId).catch((err) => {
      logger.debug({ hostId, err: err.message }, 'Could not fetch host user');
      return null;
    });
    if (!user) {
      logger.warn({ hostId }, 'Could not fetch host user for DM');
      return;
    }

    const ts = Math.floor(new Date(event.created_at).getTime() / 1000);

const fields = [
  { name: 'Type', value: '`' + event.event_type_key + '`', inline: true },
  { name: 'Logged', value: '<t:' + ts + ':R>', inline: true },
  { name: 'Attendees', value: String(event.attendeeEntries.length), inline: true },
];

if (event.cohost_discord_id) {
  fields.push({ name: 'Co-host', value: '<@' + event.cohost_discord_id + '>', inline: true });
}

if (approverId) {
  fields.push({
    name: color === COLORS.SUCCESS ? 'Approved By' : 'Reviewed By',
    value: '<@' + approverId + '>',
    inline: true,
  });
}
// After DMing the host, also DM the cohost if set
if (event.cohost_discord_id && event.cohost_discord_id !== event.host_discord_id) {
  try {
    const cohostUser = await client.users.fetch(event.cohost_discord_id).catch(() => null);
    if (cohostUser) {
      await cohostUser.send({ embeds: [embed] });
    }
  } catch {}
}
    if (reason) {
      fields.push({ name: 'Reason', value: reason, inline: false });
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .addFields(fields)
      .setTimestamp(new Date());

    if (extraLine) embed.setDescription(extraLine);

    await user.send({ embeds: [embed] });
    logger.info({ hostId, title }, 'Event outcome DM sent');
  } catch (err) {
    logger.warn(
      { err: err.message, hostId: event?.host_discord_id },
      'Could not DM event outcome (user may have DMs closed)'
    );
  }
}

function parseAction(customId) {
  const m = /^event:(approve|reject):(\d+)$/.exec(customId);
  if (!m) return null;
  return { kind: m[1], eventId: m[2] };
}

async function checkPermission(discordId, permissionKey) {
  const user = await userRepo.findByDiscordId(discordId);
  if (!user) return false;
  return permissionService.hasPermission(user.id, permissionKey);
}
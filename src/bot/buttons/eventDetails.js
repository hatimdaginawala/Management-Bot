import { MessageFlags } from 'discord.js';
import * as eventService from '../../services/event.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { infoEmbed, errorEmbed } from '../embedBuilders.js';
import { AuthorizationError } from '../../utils/errors.js';

export const customId = 'event:details:*';
export const meta = {};

export async function execute(interaction) {
  const eventId = extractId(interaction.customId);
  if (!eventId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Error', description: 'Malformed interaction.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'events.view');
  if (!ok) throw new AuthorizationError('You do not have permission to view events.');

  const event = await eventService.getEvent(eventId);

  const ts = Math.floor(new Date(event.created_at).getTime() / 1000);
  const statusEmoji = { PENDING: '🟡', APPROVED: '🟢', REJECTED: '🔴', CANCELLED: '⚫' }[event.status] || '⚪';

  const attendeeList = event.attendeeEntries.length > 0
    ? event.attendeeEntries.map((a, i) => {
        if (a.discordId) {
          const tag = a.isVerified ? '' : ' _(unverified)_';
          return (i + 1) + '. <@' + a.discordId + '>' + tag;
        }
        return (i + 1) + '. `' + (a.robloxUsername || 'unknown') + '` _(unverified)_';
      }).join('\n').slice(0, 1000)
    : '_none_';

  const fields = [
    { name: 'Status', value: statusEmoji + ' `' + event.status + '`', inline: true },
    { name: 'Type', value: '`' + event.event_type_key + '`', inline: true },
    { name: 'Logged', value: '<t:' + ts + ':f>', inline: true },
    { name: 'Host', value: '<@' + event.host_discord_id + '>', inline: true },
    { name: 'Attendees (' + event.attendeeEntries.length + ')', value: attendeeList, inline: false },
    { name: 'Proof', value: '<' + event.proof_url + '>', inline: false },
  ];

  if (event.notes) fields.push({ name: 'Notes', value: event.notes.slice(0, 1000), inline: false });
  if (event.rejection_reason) fields.push({ name: 'Rejection Reason', value: event.rejection_reason.slice(0, 1000), inline: false });
  if (event.cancellation_reason) fields.push({ name: 'Cancellation Reason', value: event.cancellation_reason.slice(0, 1000), inline: false });

  return interaction.reply({
    embeds: [infoEmbed({ title: 'Event Details', fields })],
    flags: MessageFlags.Ephemeral,
  });
}

function extractId(customId) {
  const m = /^event:details:(\d+)$/.exec(customId);
  return m ? m[1] : null;
}
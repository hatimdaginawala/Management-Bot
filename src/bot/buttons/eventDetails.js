import { MessageFlags } from 'discord.js';
import * as eventService from '../../services/event.service.js';
import * as permissionService from '../../services/permission.service.js';
import { infoEmbed, errorEmbed } from '../embedBuilders.js';
import { AuthorizationError } from '../../utils/errors.js';
import { User } from '../../models/index.js';

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

  // Permission: anyone with events.view can see details.
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user._id, 'events.view');
  if (!ok) throw new AuthorizationError('You do not have permission to view events.');

  const event = await eventService.getEvent(eventId);

  const ts = Math.floor(new Date(event.createdAt).getTime() / 1000);

  const statusEmoji = {
    PENDING: '🟡',
    APPROVED: '🟢',
    REJECTED: '🔴',
    CANCELLED: '⚫',
  }[event.status] || '⚪';

  const attendeeList = event.attendeeEntries.length > 0
    ? event.attendeeEntries
        .map((a, i) => {
          if (a.discordId) {
            const tag = a.isVerified ? '' : ' _(unverified)_';
            return (i + 1) + '. <@' + a.discordId + '>' + tag;
          }
          return (i + 1) + '. `' + (a.robloxUsername || 'unknown') + '` _(unverified)_';
        })
        .join('\n')
        .slice(0, 1000)
    : '_none_';

  const fields = [
    { name: 'Status', value: statusEmoji + ' `' + event.status + '`', inline: true },
    { name: 'Type', value: '`' + event.eventTypeKey + '`', inline: true },
    { name: 'Logged', value: '<t:' + ts + ':f>', inline: true },
    { name: 'Host', value: '<@' + event.host.discordId + '>', inline: true },
    { name: 'Attendees (' + event.attendeeEntries.length + ')', value: attendeeList, inline: false },
    { name: 'Proof', value: '<' + event.proofUrl + '>', inline: false },
  ];

  if (event.notes) {
    fields.push({ name: 'Notes', value: event.notes.slice(0, 1000), inline: false });
  }
  if (event.rejectionReason) {
    fields.push({ name: 'Rejection Reason', value: event.rejectionReason.slice(0, 1000), inline: false });
  }
  if (event.cancellationReason) {
    fields.push({ name: 'Cancellation Reason', value: event.cancellationReason.slice(0, 1000), inline: false });
  }

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Event Details',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

function extractId(customId) {
  const m = /^event:details:([a-f0-9]{24})$/.exec(customId);
  return m ? m[1] : null;
}
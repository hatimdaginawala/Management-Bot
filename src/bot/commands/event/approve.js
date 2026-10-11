import { MessageFlags } from 'discord.js';
import * as eventService from '../../../services/event.service.js';
import * as permissionService from '../../../services/permission.service.js';
import { User } from '../../../models/index.js';
import { AuthorizationError } from '../../../utils/errors.js';
import { infoEmbed, successEmbed } from '../../embedBuilders.js';
import { showEventPicker, formatEventSummary } from '../../components/eventPicker.js';

export async function handleApprove(interaction) {
  await assertPermission(interaction, 'events.approve');

  const result = await eventService.listEvents({
    status: 'PENDING',
    page: 1,
    pageSize: 25,
  });

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Pending Events',
        description: 'There are no events waiting for approval.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (result.total === 1) {
    const event = result.items[0];
    const { alreadyApproved } = await eventService.approveEvent(
      interaction.user.id,
      event._id
    );
    return interaction.reply({
      embeds: [successEmbed({
        title: alreadyApproved ? 'Already Approved' : 'Event Approved',
        description: formatEventSummary(event),
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  return showEventPicker(interaction, {
    events: result.items,
    action: 'approve',
    title: 'Approve Event',
    description: 'Select the pending event you want to approve.',
  });
}

export async function assertPermission(interaction, permissionKey) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
  const ok = await permissionService.hasPermission(user._id, permissionKey);
  if (!ok) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
}
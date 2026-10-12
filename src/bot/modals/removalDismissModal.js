import { MessageFlags } from 'discord.js';
import * as removalRequestService from '../../services/removalRequest.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { dmRemovalDismissed } from '../utils/userDm.js';

export const customId = 'modal:removal-dismiss';
export const meta = {};

export async function execute(interaction) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'removal.dismiss');
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');

  const session = sessions.getSession('removal:dismiss', interaction.user.id);
  if (!session || !session.requestId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Session Expired', description: 'Please run `/strike dismiss-removal` again.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (reason.length < 3) throw new ValidationError('Reason must be at least 3 characters.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const request = await removalRequestService.dismissRemoval(
    interaction.user.id,
    session.requestId,
    { reason }
  );

  sessions.clearSession('removal:dismiss', interaction.user.id);

  await dmRemovalDismissed(interaction.client, request, {
    actorId: interaction.user.id,
    reason,
  });

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Removal Dismissed',
      description: 'Removal request for <@' + request.discord_id + '> has been dismissed.',
      fields: [{ name: 'Reason', value: reason, inline: false }],
    })],
  });
}
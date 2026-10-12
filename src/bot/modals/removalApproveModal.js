import { MessageFlags } from 'discord.js';
import * as removalRequestService from '../../services/removalRequest.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { dmRemovalApproved } from '../utils/userDm.js';

export const customId = 'modal:removal-approve';
export const meta = {};

export async function execute(interaction) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'removal.approve');
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');

  const session = sessions.getSession('removal:approve', interaction.user.id);
  if (!session || !session.requestId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Session Expired', description: 'Please run `/strike approve-removal` again.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const effectiveRaw = interaction.fields.getTextInputValue('effectiveAt').trim();
  const reason = interaction.fields.getTextInputValue('reason').trim();

  let effectiveAt = null;
  if (effectiveRaw) {
    const d = new Date(effectiveRaw + 'T00:00:00.000Z');
    if (Number.isNaN(d.getTime())) throw new ValidationError('Effective date must be YYYY-MM-DD.');
    effectiveAt = d;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const request = await removalRequestService.approveRemoval(
    interaction.user.id,
    session.requestId,
    { reason: reason || null, effectiveAt }
  );

  sessions.clearSession('removal:approve', interaction.user.id);

  await dmRemovalApproved(interaction.client, request, {
    actorId: interaction.user.id,
    effectiveAt: request.removal_effective_at,
    reason: reason || null,
  });

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Removal Approved',
      description: 'Removal request for <@' + request.discord_id + '> has been approved.',
      fields: [
        { name: 'Effective', value: '<t:' + Math.floor(new Date(request.removal_effective_at).getTime() / 1000) + ':f>', inline: true },
        ...(reason ? [{ name: 'Reason', value: reason, inline: false }] : []),
      ],
    })],
  });
}
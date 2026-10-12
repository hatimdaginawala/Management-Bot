import { MessageFlags } from 'discord.js';
import * as strikeService from '../../services/strike.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { dmStrikeIssued, dmStrikeResolved } from '../utils/userDm.js';

export const customId = [
  'modal:strike-issue',
  'modal:strike-remove',
  'modal:strike-recover',
];
export const meta = {};

export async function execute(interaction) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');

  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (reason.length < 3) throw new ValidationError('Reason must be at least 3 characters.');

  const customId = interaction.customId;

  if (customId === 'modal:strike-issue') {
    await requirePermission(user, 'strikes.issue');
    const session = sessions.getSession('strike:issue', interaction.user.id);
    if (!session || !session.userId) return replyExpired(interaction, '/strike issue');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const strike = await strikeService.issueManualStrike(interaction.user.id, {
      targetDiscordId: session.userId,
      reason,
    });
    sessions.clearSession('strike:issue', interaction.user.id);

    await dmStrikeIssued(interaction.client, {
      discordId: session.userId,
      id: strike.id,
      type: strike.type,
      reason: strike.reason,
      quota_period_key: strike.quota_period_key,
      issued_at: strike.issued_at,
    }, { actorId: interaction.user.id });

    return interaction.editReply({
      embeds: [successEmbed({
        title: 'Strike Issued',
        description: 'Issued a manual strike to <@' + session.userId + '>.',
        fields: [{ name: 'Reason', value: reason, inline: false }],
      })],
    });
  }

  if (customId === 'modal:strike-remove') {
    await requirePermission(user, 'strikes.remove');
    const session = sessions.getSession('strike:remove', interaction.user.id);
    if (!session || !session.strikeId) return replyExpired(interaction, '/strike remove');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await strikeService.removeStrike(interaction.user.id, session.strikeId, { reason });
    sessions.clearSession('strike:remove', interaction.user.id);

    if (result.removed && result.strike?.discord_id) {
      await dmStrikeResolved(interaction.client, result.strike, {
        resolvedAs: 'CANCELLED', reason, actorId: interaction.user.id,
      });
    }

    return interaction.editReply({
      embeds: [successEmbed({
        title: result.removed ? 'Strike Removed' : 'Already Removed',
        description: 'Strike `' + session.strikeId + '`.',
        fields: [{ name: 'Reason', value: reason, inline: false }],
      })],
    });
  }

  if (customId === 'modal:strike-recover') {
    await requirePermission(user, 'strikes.remove');
    const session = sessions.getSession('strike:recover', interaction.user.id);
    if (!session || !session.strikeId) return replyExpired(interaction, '/strike recover');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await strikeService.recoverStrike(interaction.user.id, session.strikeId, { reason });
    sessions.clearSession('strike:recover', interaction.user.id);

    if (result.recovered && result.strike?.discord_id) {
      await dmStrikeResolved(interaction.client, result.strike, {
        resolvedAs: 'RECOVERED', reason, actorId: interaction.user.id,
      });
    }

    return interaction.editReply({
      embeds: [successEmbed({
        title: result.recovered ? 'Strike Recovered' : 'Already Recovered',
        description: 'Strike `' + session.strikeId + '`.',
        fields: [{ name: 'Reason', value: reason, inline: false }],
      })],
    });
  }
}

async function requirePermission(user, permissionKey) {
  const ok = await permissionService.hasPermission(user.id, permissionKey);
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');
}

async function replyExpired(interaction, command) {
  return interaction.reply({
    embeds: [errorEmbed({ title: 'Session Expired', description: 'Please run `' + command + '` again.' })],
    flags: MessageFlags.Ephemeral,
  });
}
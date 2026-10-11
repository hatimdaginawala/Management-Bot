import { MessageFlags } from 'discord.js';
import * as userService from '../../services/user.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError } from '../../utils/errors.js';
import { successEmbed, warningEmbed } from '../embedBuilders.js';
import { dmExemptionRevoked } from '../utils/userDm.js';

export const customId = 'quota:unexempt:user';
export const meta = {};

export async function execute(interaction) {
  const actor = await User.findOne({ discordId: interaction.user.id });
  if (!actor) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(actor._id, 'quota.exempt');
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');

  const targetDiscordId = interaction.values[0];

  const target = await User.findOne({ discordId: targetDiscordId }).lean();
  if (!target) {
    return interaction.update({
      embeds: [warningEmbed({
        title: 'User Not Registered',
        description: '<@' + targetDiscordId + '> is not registered with the bot.',
      })],
      components: [],
    });
  }

  const wasExempt = Boolean(target.quota && target.quota.exempt);
  if (!wasExempt) {
    return interaction.update({
      embeds: [warningEmbed({
        title: 'Not Exempt',
        description: '<@' + targetDiscordId + '> does not have an active exemption.',
      })],
      components: [],
    });
  }

  await userService.clearQuotaExemption(interaction.user.id, targetDiscordId, {
    reason: 'Revoked via /quota unexempt',
  });

  await dmExemptionRevoked(interaction.client, targetDiscordId, {
    actorId: interaction.user.id,
  });

  return interaction.update({
    embeds: [successEmbed({
      title: 'Exemption Revoked',
      description: '<@' + targetDiscordId + '> is no longer exempt from weekly quota.',
    })],
    components: [],
  });
}
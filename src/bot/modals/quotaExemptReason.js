import { MessageFlags } from 'discord.js';
import * as userService from '../../services/user.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { dmExemptionGranted } from '../utils/userDm.js';

export const customId = 'modal:quota-exempt-reason';
export const meta = {};

export async function execute(interaction) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user._id, 'quota.exempt');
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');

  const session = sessions.getSession('quota:exempt', interaction.user.id);
  if (!session || !session.userId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Session Expired', description: 'Please run `/quota exempt` again.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (reason.length < 3) throw new ValidationError('Reason must be at least 3 characters.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const target = await userService.setQuotaExemption(interaction.user.id, session.userId, { reason });

  sessions.clearSession('quota:exempt', interaction.user.id);

  await dmExemptionGranted(interaction.client, session.userId, {
    reason,
    exemptUntil: target?.quota?.exemptUntil ?? null,
    actorId: interaction.user.id,
  });

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Quota Exemption Granted',
      description: '<@' + session.userId + '> is now exempt from weekly quota.',
      fields: [{ name: 'Reason', value: reason, inline: false }],
    })],
  });
}
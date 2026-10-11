import { MessageFlags } from 'discord.js';
import * as quotaPolicyService from '../../services/quotaPolicy.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed } from '../embedBuilders.js';

export const customId = 'modal:quota-set';
export const meta = {};

export async function execute(interaction) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user._id, 'quota.manage');
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');

  const category = interaction.fields.getTextInputValue('category').trim().toUpperCase();
  const amountRaw = interaction.fields.getTextInputValue('amount').trim();
  const recoveryRaw = interaction.fields.getTextInputValue('recoveryMultiplier').trim();
  const notes = interaction.fields.getTextInputValue('notes').trim();

  if (!['STAFF', 'LOW_RANK'].includes(category)) {
    throw new ValidationError('Category must be STAFF or LOW_RANK.');
  }
  const amount = Number.parseInt(amountRaw, 10);
  if (!Number.isInteger(amount) || amount < 0 || amount > 999) {
    throw new ValidationError('Amount must be an integer between 0 and 999.');
  }
  const recoveryMultiplier = recoveryRaw ? Number.parseInt(recoveryRaw, 10) : 2;
  if (!Number.isInteger(recoveryMultiplier) || recoveryMultiplier < 1 || recoveryMultiplier > 99) {
    throw new ValidationError('Recovery multiplier must be an integer between 1 and 99.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const policy = await quotaPolicyService.setPolicy(interaction.user.id, {
    category,
    amount,
    recoveryMultiplier,
    notes,
  });

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Quota Policy Set',
      description: 'A new policy has been activated for **' + category + '**.',
      fields: [
        { name: 'Amount', value: String(policy.amount), inline: true },
        { name: 'Metric', value: '`' + policy.metric + '`', inline: true },
        { name: 'Recovery Multiplier', value: policy.recoveryMultiplier + 'x', inline: true },
        ...(notes ? [{ name: 'Notes', value: notes, inline: false }] : []),
      ],
    })],
  });
}
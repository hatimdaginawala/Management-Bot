import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { errorEmbed } from '../embedBuilders.js';
import { AuthorizationError } from '../../utils/errors.js';
import * as sessions from '../sessions.js';

export const customId = ['removal:approve:*', 'removal:dismiss:*'];
export const meta = {};

export async function execute(interaction) {
  const parsed = parseAction(interaction.customId);
  if (!parsed) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Error', description: 'Malformed interaction.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (parsed.kind === 'approve') return handleApprove(interaction, parsed.requestId);
  if (parsed.kind === 'dismiss') return handleDismiss(interaction, parsed.requestId);
}

async function handleApprove(interaction, requestId) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'removal.approve');
  if (!ok) throw new AuthorizationError('You do not have permission to approve removals.');

  sessions.startSession('removal:approve', interaction.user.id, { requestId });

  const modal = new ModalBuilder()
    .setCustomId('modal:removal-approve')
    .setTitle('Approve Removal');

  const dateInput = new TextInputBuilder()
    .setCustomId('effectiveAt')
    .setLabel('Effective date (YYYY-MM-DD, optional)')
    .setPlaceholder('Leave empty for default (3 days from now)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(dateInput),
    new ActionRowBuilder().addComponents(reasonInput)
  );

  return interaction.showModal(modal);
}

async function handleDismiss(interaction, requestId) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'removal.dismiss');
  if (!ok) throw new AuthorizationError('You do not have permission to dismiss removals.');

  sessions.startSession('removal:dismiss', interaction.user.id, { requestId });

  const modal = new ModalBuilder()
    .setCustomId('modal:removal-dismiss')
    .setTitle('Dismiss Removal');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for dismissal')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}

function parseAction(customId) {
  const m = /^removal:(approve|dismiss):(\d+)$/.exec(customId);
  return m ? { kind: m[1], requestId: m[2] } : null;
}
import { MessageFlags } from 'discord.js';
import * as noticeService from '../../services/notice.service.js';
import * as settingsService from '../../services/settings.service.js';
import * as noticeRepo from '../../db/repositories/notice.repository.js';
import { infoEmbed, errorEmbed } from '../embedBuilders.js';
import { ValidationError } from '../../utils/errors.js';
import * as sessions from '../sessions.js';

export const customId = 'modal:notice-extend';
export const meta = {};

export async function execute(interaction) {
  const session = sessions.getSession('notice:extend', interaction.user.id);
  if (!session || !session.noticeId) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Session Expired', description: 'Please run `/notice extend` again.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const newEndRaw = interaction.fields.getTextInputValue('newEndAt').trim();
  const reason = interaction.fields.getTextInputValue('reason').trim();

  const newEndAt = new Date(newEndRaw + 'T23:59:59.999Z');
  if (Number.isNaN(newEndAt.getTime())) throw new ValidationError('End date must be YYYY-MM-DD.');
  if (newEndAt <= new Date()) throw new ValidationError('New end date must be in the future.');
  if (reason.length < 3) throw new ValidationError('Reason must be at least 3 characters.');

  const notice = await noticeRepo.findById(session.noticeId);
  if (!notice) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Notice Not Found', description: 'The notice no longer exists.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await noticeService.requestExtension(interaction.user.id, session.noticeId, {
    newEndAt,
    reason,
  });

  sessions.clearSession('notice:extend', interaction.user.id);

  const settings = await settingsService.getSettings();
  const approvalChannelId = settings?.channels?.auditChannelId;
  if (approvalChannelId) {
    try {
      const channel = await interaction.client.channels.fetch(approvalChannelId);
      if (channel?.isTextBased?.()) {
        await channel.send({
          content:
            '<@' + interaction.user.id + '> requested an extension for their `' + notice.type + '` notice.\n' +
            'New end: <t:' + Math.floor(newEndAt.getTime() / 1000) + ':d>\n' +
            'Reason: ' + reason + '\n\n' +
            'Review with `/notice approve-extension` or `/notice reject-extension`.',
        });
      }
    } catch {}
  }

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Extension Requested',
      description: 'Your notice extension request has been submitted for review.',
      fields: [
        { name: 'New End Date', value: '<t:' + Math.floor(newEndAt.getTime() / 1000) + ':d>', inline: true },
        { name: 'Reason', value: reason, inline: false },
      ],
    })],
    flags: MessageFlags.Ephemeral,
  });
}
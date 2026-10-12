import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import * as settingsService from '../../services/settings.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed, successEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { SETTINGS_META, formatSettingValue } from '../../constants/settingsMeta.js';

export const customId = ['settings:set:setting', 'settings:reset:setting'];
export const meta = {};

export async function execute(interaction) {
  const kind = interaction.customId.split(':')[1];
  const path = interaction.values[0];
  const flowKind = 'settings:' + kind;

  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user.id, 'settings.manage');
  if (!ok) throw new AuthorizationError('You do not have permission to change settings.');

  const session = sessions.getSession(flowKind, interaction.user.id);
  if (!session) {
    return interaction.update({
      embeds: [infoEmbed({ title: 'Session Expired', description: 'Please run the command again.' })],
      components: [],
    });
  }

  const meta = SETTINGS_META[path];

  if (kind === 'reset') {
    await interaction.deferUpdate();
    try {
      const newValue = await settingsService.resetSetting(interaction.user.id, path, {
        reason: 'Reset via /settings reset',
      });
      sessions.clearSession(flowKind, interaction.user.id);
      return interaction.editReply({
        embeds: [successEmbed({
          title: 'Setting Reset',
          description: '**' + (meta?.label || path) + '** has been reset to its default.',
          fields: [
            { name: 'Path', value: '`' + path + '`', inline: false },
            { name: 'New Value', value: formatSettingValue(newValue, meta?.format), inline: false },
          ],
        })],
        components: [],
      });
    } catch (err) {
      return interaction.editReply({
        embeds: [infoEmbed({
          title: 'Reset Failed',
          description: err.isOperational ? err.message : 'An unexpected error occurred.',
        })],
        components: [],
      });
    }
  }

  sessions.updateSession(flowKind, interaction.user.id, { path, step: 'value' });

  const current = await settingsService.getSetting(path);
  const displayCurrent = formatSettingValue(current, meta?.format).replace(/[*`<>#]/g, '').trim();

  const modal = new ModalBuilder()
    .setCustomId('modal:settings-set')
    .setTitle(('Set: ' + (meta?.label || path)).slice(0, 45));

  const valueInput = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(('New value (current: ' + displayCurrent + ')').slice(0, 45))
    .setPlaceholder(placeholderFor(meta?.format))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(300);

  modal.addComponents(
    new ActionRowBuilder().addComponents(valueInput),
    new ActionRowBuilder().addComponents(reasonInput)
  );

  return interaction.showModal(modal);
}

function placeholderFor(format) {
  switch (format) {
    case 'boolean':         return 'true or false';
    case 'channel':         return 'Discord channel ID';
    case 'number:minutes':  return 'e.g. 15';
    case 'number:days':     return 'e.g. 7';
    case 'number:count':    return 'e.g. 3';
    case 'weekday':         return '0 (Sun) through 6 (Sat)';
    case 'timezone':        return 'e.g. Asia/Kolkata';
    case 'cron':            return 'e.g. 0 22 * * 0';
    default:                return 'New value';
  }
}
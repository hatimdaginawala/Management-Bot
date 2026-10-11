import { MessageFlags } from 'discord.js';
import * as settingsService from '../../services/settings.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { successEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { SETTINGS_META, formatSettingValue } from '../../constants/settingsMeta.js';

export const customId = 'modal:settings-set';
export const meta = {};

export async function execute(interaction) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(user._id, 'settings.manage');
  if (!ok) throw new AuthorizationError('You do not have permission to change settings.');

  const session = sessions.getSession('settings:set', interaction.user.id);
  if (!session || !session.path) {
    return interaction.reply({
      embeds: [successEmbed({
        title: 'Session Expired',
        description: 'Please run `/settings set` again.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const path = session.path;
  const rawValue = interaction.fields.getTextInputValue('value').trim();
  const reason = interaction.fields.getTextInputValue('reason').trim() || null;

  // Coerce based on current value type.
  const coerced = await coerceValue(path, rawValue);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const newValue = await settingsService.setSetting(interaction.user.id, path, coerced, { reason });
  sessions.clearSession('settings:set', interaction.user.id);

  const meta = SETTINGS_META[path];

  return interaction.editReply({
    embeds: [successEmbed({
      title: 'Setting Updated',
      description: '**' + (meta?.label || path) + '** has been updated.',
      fields: [
        { name: 'Path', value: '`' + path + '`', inline: false },
        { name: 'New Value', value: formatSettingValue(newValue, meta?.format), inline: false },
        ...(reason ? [{ name: 'Reason', value: reason, inline: false }] : []),
      ],
    })],
  });
}

async function coerceValue(path, raw) {
  const current = await settingsService.getSetting(path);

  if (typeof current === 'boolean') {
    const low = raw.toLowerCase();
    if (['true', 'yes', 'y', '1', 'on'].includes(low)) return true;
    if (['false', 'no', 'n', '0', 'off'].includes(low)) return false;
    throw new ValidationError('Expected a boolean (true/false/yes/no).');
  }

  if (typeof current === 'number') {
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n)) throw new ValidationError('Expected an integer.');
    return n;
  }

  // null / string: try common coercions.
  if (raw === 'null' || raw === 'none' || raw === 'unset') return null;
  return raw;
}
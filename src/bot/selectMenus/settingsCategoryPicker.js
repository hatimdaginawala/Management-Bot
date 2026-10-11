import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import {
  SETTINGS_META,
  SETTINGS_GROUPS,
  formatSettingValue,
} from '../../constants/settingsMeta.js';
import * as settingsService from '../../services/settings.service.js';

export const customId = ['settings:set:category', 'settings:reset:category'];
export const meta = {};

export async function execute(interaction) {
  const kind = interaction.customId.split(':')[1]; // set | reset
  const groupKey = interaction.values[0];

  const flowKind = 'settings:' + kind;
  sessions.updateSession(flowKind, interaction.user.id, {
    group: groupKey,
    step: 'setting',
  });

  // Fetch current settings so we can show current values in the picker description.
  const doc = await settingsService.getSettings();

  const entries = Object.entries(SETTINGS_META)
    .filter(([, m]) => m.group === groupKey);

  const options = entries.map(([path, m]) => {
    const value = readPath(doc, path);
    const current = formatSettingValue(value, m.format).replace(/[*`]/g, ''); // strip markdown for description
    return {
      label: m.label.slice(0, 100),
      description: ('Currently: ' + current).slice(0, 100),
      value: path,
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(flowKind + ':setting')
    .setPlaceholder('Pick a setting')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  const groupLabel = SETTINGS_GROUPS.find((g) => g.key === groupKey)?.label || groupKey;

  return interaction.update({
    embeds: [infoEmbed({
      title: 'Select a Setting — ' + groupLabel,
      description: 'Pick the setting you want to ' + kind + '.',
    })],
    components: [row],
  });
}

function readPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
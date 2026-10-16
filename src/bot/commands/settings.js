// src/bot/commands/settings.js

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as settingsService from '../../services/settings.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { SETTINGS_META, SETTINGS_GROUPS, formatSettingValue } from '../../constants/settingsMeta.js';
import { openMenuForModule, replyOrUpdate } from '../menus/render.js';

export const data = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('View and edit bot settings.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  return openMenuForModule(interaction, ctx, 'settings');
}

async function handleView(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'settings.view');
  const groupFilter = params.group ?? interaction.options?.getString?.('group');

  const doc = await settingsService.getSettings();

  const sections = new Map();
  for (const [path, meta] of Object.entries(SETTINGS_META)) {
    if (groupFilter && meta.group !== groupFilter) continue;
    const value = readPath(doc, path);
    const formatted = formatSettingValue(value, meta.format);
    const line = '**' + meta.label + '** — ' + formatted + '\n' +
                 '  _' + meta.description + '_\n' +
                 '  `' + path + '`';
    const list = sections.get(meta.group) || [];
    list.push(line);
    sections.set(meta.group, list);
  }

  const fields = [];
  for (const g of SETTINGS_GROUPS) {
    if (!sections.has(g.key)) continue;
    const lines = sections.get(g.key);
    let current = '';
    const flush = (nameSuffix) => {
      if (current) {
        fields.push({
          name: g.emoji + ' ' + g.label + (nameSuffix ? ' (cont.)' : ''),
          value: current.slice(0, 1020),
          inline: false,
        });
        current = '';
      }
    };
    let isFirstChunk = true;
    for (const line of lines) {
      const candidate = current ? current + '\n\n' + line : line;
      if (candidate.length > 1000) {
        flush(!isFirstChunk);
        isFirstChunk = false;
        current = line;
      } else {
        current = candidate;
      }
    }
    flush(!isFirstChunk);
  }

  const embeds = [];
  for (let i = 0; i < fields.length; i += 25) {
    embeds.push(infoEmbed({
      title: i === 0 ? 'Current Settings' + (groupFilter ? ' — ' + groupFilter : '') : '​',
      description: i === 0 ? 'Use `/settings` → Change Setting to edit a value.' : null,
      fields: fields.slice(i, i + 25),
    }));
  }

  return replyOrUpdate(interaction, { embeds, flags: MessageFlags.Ephemeral });
}

async function handlePaths(interaction, ctx) {
  await assertPermission(interaction, 'settings.view');

  const lines = Object.entries(SETTINGS_META).map(
    ([path, meta]) => '• `' + path + '` — ' + meta.description
  );

  const chunks = [];
  let current = '';
  for (const line of lines) {
    const candidate = current ? current + '\n' + line : line;
    if (candidate.length > 1000) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  const embeds = chunks.slice(0, 5).map((chunk, i) =>
    infoEmbed({
      title: i === 0 ? 'Writable Setting Paths (' + lines.length + ')' : '​',
      description: chunk,
    })
  );

  return replyOrUpdate(interaction, { embeds, flags: MessageFlags.Ephemeral });
}

async function startSetFlow(interaction, ctx) {
  await assertPermission(interaction, 'settings.manage');
  sessions.startSession('settings:set', interaction.user.id, { step: 'category' });
  await renderCategoryPicker(interaction, interaction.user.id, 'settings:set', 'Change Setting');
}

async function startResetFlow(interaction, ctx) {
  await assertPermission(interaction, 'settings.manage');
  sessions.startSession('settings:reset', interaction.user.id, { step: 'category' });
  await renderCategoryPicker(interaction, interaction.user.id, 'settings:reset', 'Reset Setting');
}

export async function renderCategoryPicker(interaction, discordId, flowKind, title) {
  const session = sessions.getSession(flowKind, discordId);
  if (!session) return sendExpired(interaction);

  const options = SETTINGS_GROUPS.map((g) => ({
    label: g.label,
    value: g.key,
    description: countInGroup(g.key) + ' settings',
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(flowKind + ':category')
    .setPlaceholder('Pick a settings group')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title, description: 'Pick a group to see its settings.' })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function sendExpired(interaction) {
  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({ title: 'Session Expired', description: 'Please run the command again.' })],
    components: [],
    flags: MessageFlags.Ephemeral,
  });
}

export { sendExpired };

function countInGroup(groupKey) {
  return Object.values(SETTINGS_META).filter((m) => m.group === groupKey).length;
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

async function assertPermission(interaction, permissionKey) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission to perform this action.');
  const ok = await permissionService.hasPermission(user.id, permissionKey);
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');
}

export const HANDLERS = {
  view: handleView,
  paths: handlePaths,
  set: startSetFlow,
  reset: startResetFlow,
};
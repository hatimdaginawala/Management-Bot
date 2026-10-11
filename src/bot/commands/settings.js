import {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as settingsService from '../../services/settings.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import {
  SETTINGS_META,
  SETTINGS_GROUPS,
  formatSettingValue,
} from '../../constants/settingsMeta.js';
import logger from '../../config/logger.js';

export const data = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('View and edit bot settings.')
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('View all current settings.')
      .addStringOption((opt) =>
        opt
          .setName('group')
          .setDescription('Filter to one group')
          .addChoices(
            ...SETTINGS_GROUPS.map((g) => ({ name: g.label, value: g.key }))
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName('paths').setDescription('List every writable setting path.')
  )
  .addSubcommand((sub) =>
    sub.setName('set').setDescription('Change a setting.')
  )
  .addSubcommand((sub) =>
    sub.setName('reset').setDescription('Reset a setting to its default.')
  )
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'view':   return handleView(interaction);
    case 'paths':  return handlePaths(interaction);
    case 'set':    return startSetFlow(interaction);
    case 'reset':  return startResetFlow(interaction);
    default:
      throw new Error('Unknown /settings subcommand: ' + sub);
  }
}

// ============================================================
//  view
// ============================================================

async function handleView(interaction) {
  await assertPermission(interaction, 'settings.view');
  const groupFilter = interaction.options.getString('group');

  const doc = await settingsService.getSettings();

  // Walk the meta to build grouped sections.
  const sections = new Map(); // group -> lines[]
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

  // Build embed fields, one per group, chunked to fit 1024-char field limit.
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

  // Split fields into embeds of max 25 fields each.
  const embeds = [];
  for (let i = 0; i < fields.length; i += 25) {
    embeds.push(infoEmbed({
      title: i === 0
        ? 'Current Settings' + (groupFilter ? ' — ' + labelFor(groupFilter) : '')
        : '​',
      description: i === 0 ? 'Use `/settings set` to change any value.' : null,
      fields: fields.slice(i, i + 25),
    }));
  }

  return interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
}

// ============================================================
//  paths
// ============================================================

async function handlePaths(interaction) {
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

  return interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
}

// ============================================================
//  set — category picker → setting picker → modal
// ============================================================

async function startSetFlow(interaction) {
  await assertPermission(interaction, 'settings.manage');

  sessions.startSession('settings:set', interaction.user.id, { step: 'category' });

  await renderCategoryPicker(interaction, interaction.user.id, 'settings:set', 'Change Setting');
}

async function startResetFlow(interaction) {
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
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  const embed = infoEmbed({
    title: title,
    description: 'Pick a group to see its settings.',
  });

  if (interaction.deferred && !interaction.replied) {
    return interaction.editReply({ embeds: [embed], components: [row] });
  }
  if (interaction.isStringSelectMenu() || interaction.isButton()) {
    return interaction.update({ embeds: [embed], components: [row] });
  }
  return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

async function sendExpired(interaction) {
  const embed = infoEmbed({
    title: 'Session Expired',
    description: 'Please run the command again.',
  });
  if (interaction.deferred || interaction.replied || interaction.isStringSelectMenu()) {
    return interaction.update({ embeds: [embed], components: [] });
  }
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export { sendExpired };

// ============================================================
//  helpers
// ============================================================

function countInGroup(groupKey) {
  return Object.values(SETTINGS_META).filter((m) => m.group === groupKey).length;
}

function labelFor(groupKey) {
  const g = SETTINGS_GROUPS.find((x) => x.key === groupKey);
  return g ? g.label : groupKey;
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
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
  const ok = await permissionService.hasPermission(user._id, permissionKey);
  if (!ok) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
}
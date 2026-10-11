import {
  SlashCommandBuilder,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as attendanceService from '../../services/attendance.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import { paginate } from '../components/pagination.js';
import * as sessions from '../sessions.js';

export const data = new SlashCommandBuilder()
  .setName('attendance')
  .setDescription('Attendance records and manual corrections.')
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('View attendance records for a user.')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Target user (default: yourself)')
      )
      .addIntegerOption((opt) =>
        opt.setName('page').setDescription('Page number').setMinValue(1)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('history')
      .setDescription('Full attendance timeline for a user.')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Target user (default: yourself)')
      )
      .addIntegerOption((opt) =>
        opt
          .setName('limit')
          .setDescription('How many records (max 200)')
          .setMinValue(1)
          .setMaxValue(200)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('stats')
      .setDescription('Aggregated attendance statistics.')
      .addStringOption((opt) =>
        opt
          .setName('mode')
          .setDescription('Aggregation mode')
          .addChoices(
            { name: 'Total', value: 'total' },
            { name: 'Top attendees', value: 'byUser' },
            { name: 'By event type', value: 'byType' },
            { name: 'By ISO week', value: 'byWeek' }
          )
      )
      .addStringOption((opt) =>
        opt.setName('from').setDescription('Start date (YYYY-MM-DD)')
      )
      .addStringOption((opt) =>
        opt.setName('to').setDescription('End date (YYYY-MM-DD)')
      )
  )
  .addSubcommand((sub) =>
    sub.setName('add').setDescription('Manually add a user to an event.')
  )
  .addSubcommand((sub) =>
    sub.setName('remove').setDescription('Manually remove a user from an event.')
  )
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'view':    return handleView(interaction);
    case 'history': return handleHistory(interaction);
    case 'stats':   return handleStats(interaction);
    case 'add':     return startAddFlow(interaction);
    case 'remove':  return startRemoveFlow(interaction);
    default:
      throw new Error('Unknown /attendance subcommand: ' + sub);
  }
}

// ============================================================
//  view
// ============================================================

async function handleView(interaction) {
  await assertPermission(interaction, 'attendance.view');

  const targetUser = interaction.options.getUser('user') || interaction.user;
  const startPage = interaction.options.getInteger('page') || 1;

  const filters = {
    userDiscordId: targetUser.id,
    page: startPage,
    pageSize: 10,
  };
  const result = await attendanceService.listAttendance(filters);

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Attendance',
        description: '<@' + targetUser.id + '> has no attendance records.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await paginate(interaction, {
    totalPages: result.totalPages,
    renderPage: async (page) => {
      const pageResult = await attendanceService.listAttendance({ ...filters, page });
      const lines = pageResult.items.map((r) => {
        const ts = Math.floor(new Date(r.eventAt).getTime() / 1000);
        const suffix = r.active ? '' : ' *(removed)*';
        return '- `' + r.eventTypeKey + '` — <t:' + ts + ':R>' + suffix;
      });
      return infoEmbed({
        title: 'Attendance for ' + targetUser.username + ' (' + pageResult.total + ' total)',
        description: lines.join('\n'),
      });
    },
  });
}

// ============================================================
//  history
// ============================================================

async function handleHistory(interaction) {
  await assertPermission(interaction, 'attendance.view');

  const targetUser = interaction.options.getUser('user') || interaction.user;
  const limit = interaction.options.getInteger('limit') || 50;

  const { records, activeCount, inactiveCount } =
    await attendanceService.getAttendanceHistory(targetUser.id, { limit });

  if (records.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No History',
        description: '<@' + targetUser.id + '> has no attendance history.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = records.map((r) => {
    const ts = Math.floor(new Date(r.eventAt).getTime() / 1000);
    const emoji = r.active ? '🟢' : '🔴';
    const reason = r.reason ? ' — ' + r.reason : '';
    return emoji + ' `' + r.eventTypeKey + '` — <t:' + ts + ':f>' + reason;
  });

  const embed = infoEmbed({
    title: 'Attendance History for ' + targetUser.username,
    description: lines.join('\n'),
    fields: [
      { name: 'Active', value: String(activeCount), inline: true },
      { name: 'Removed', value: String(inactiveCount), inline: true },
    ],
  });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ============================================================
//  stats
// ============================================================

async function handleStats(interaction) {
  await assertPermission(interaction, 'attendance.view');

  const mode = interaction.options.getString('mode') || 'total';
  const fromRaw = interaction.options.getString('from');
  const toRaw = interaction.options.getString('to');

  const from = fromRaw ? new Date(fromRaw) : undefined;
  const to = toRaw ? new Date(toRaw + 'T23:59:59.999Z') : undefined;

  const result = await attendanceService.attendanceStats({
    mode,
    from,
    to,
    limit: 10,
  });

  if (mode === 'total') {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Total Attendance',
        description: String(result.total),
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (mode === 'byUser') {
    const lines = result.rows.length
      ? result.rows.map((r, i) => (i + 1) + '. <@' + r.discordId + '> — ' + r.count)
      : ['No data.'];
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Top Attendees',
        description: lines.join('\n'),
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (mode === 'byType') {
    const lines = result.rows.length
      ? result.rows.map((r) => '`' + r._id + '` — ' + r.count)
      : ['No data.'];
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Attendance by Event Type',
        description: lines.join('\n'),
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (mode === 'byWeek') {
    const lines = result.rows.length
      ? result.rows.map((r) => r._id.year + '-W' + String(r._id.week).padStart(2, '0') + ' — ' + r.count)
      : ['No data.'];
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Attendance by ISO Week',
        description: lines.join('\n'),
      })],
      flags: MessageFlags.Ephemeral,
    });
  }
}

// ============================================================
//  add / remove step flows
// ============================================================

async function startAddFlow(interaction) {
  await assertPermission(interaction, 'attendance.manage');

  sessions.startSession('attendance:add', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('attendance:add:user')
    .setPlaceholder('Select the user to add')
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Add Attendance — Step 1 of 3',
      description: 'Select the Discord user you want to add to an event.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function startRemoveFlow(interaction) {
  await assertPermission(interaction, 'attendance.manage');

  sessions.startSession('attendance:remove', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('attendance:remove:user')
    .setPlaceholder('Select the user to remove')
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Remove Attendance — Step 1 of 3',
      description: 'Select the Discord user you want to remove from an event.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  helpers
// ============================================================

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
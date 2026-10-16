// src/bot/commands/attendance.js

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as attendanceService from '../../services/attendance.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import { paginate } from '../components/pagination.js';
import * as sessions from '../sessions.js';
import { openMenuForModule, replyOrUpdate } from '../menus/render.js';

export const data = new SlashCommandBuilder()
  .setName('attendance')
  .setDescription('Attendance records and manual corrections.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  return openMenuForModule(interaction, ctx, 'attendance');
}

async function handleView(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'attendance.view');

  const targetUser = params.user ?? interaction.options?.getUser?.('user') ?? interaction.user;
  const startPage = params.page ?? interaction.options?.getInteger?.('page') ?? 1;

  const filters = { userDiscordId: targetUser.id, page: startPage, pageSize: 10 };
  const result = await attendanceService.listAttendance(filters);

  if (result.total === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({
        title: 'No Attendance',
        description: '<@' + targetUser.id + '> has no attendance records.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  await paginate(interaction, {
    totalPages: result.totalPages,
    renderPage: async (page) => {
      const pageResult = await attendanceService.listAttendance({ ...filters, page });
      const lines = pageResult.items.map((r) => {
        const ts = Math.floor(new Date(r.event_at).getTime() / 1000);
        const suffix = r.active ? '' : ' *(removed)*';
        return '- `' + r.event_type_key + '` — <t:' + ts + ':R>' + suffix;
      });
      return infoEmbed({
        title: 'Attendance for ' + targetUser.username + ' (' + pageResult.total + ' total)',
        description: lines.join('\n'),
      });
    },
  });
}

async function handleHistory(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'attendance.view');

  const targetUser = params.user ?? interaction.options?.getUser?.('user') ?? interaction.user;
  const limit = params.limit ?? interaction.options?.getInteger?.('limit') ?? 50;

  const { records, activeCount, inactiveCount } =
    await attendanceService.getAttendanceHistory(targetUser.id, { limit });

  if (records.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({
        title: 'No History',
        description: '<@' + targetUser.id + '> has no attendance history.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = records.map((r) => {
    const ts = Math.floor(new Date(r.event_at).getTime() / 1000);
    const emoji = r.active ? '🟢' : '🔴';
    const reason = r.reason ? ' — ' + r.reason : '';
    return emoji + ' `' + r.event_type_key + '` — <t:' + ts + ':f>' + reason;
  });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Attendance History for ' + targetUser.username,
      description: lines.join('\n'),
      fields: [
        { name: 'Active', value: String(activeCount), inline: true },
        { name: 'Removed', value: String(inactiveCount), inline: true },
      ],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStats(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'attendance.view');

  const mode = params.mode ?? interaction.options?.getString?.('mode') ?? 'total';
  const fromRaw = params.from ?? interaction.options?.getString?.('from');
  const toRaw = params.to ?? interaction.options?.getString?.('to');

  const from = fromRaw ? new Date(fromRaw) : undefined;
  const to = toRaw ? new Date(toRaw + 'T23:59:59.999Z') : undefined;

  const result = await attendanceService.attendanceStats({ mode, from, to, limit: 10 });

  if (mode === 'total') {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Total Attendance', description: String(result.total) })],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (mode === 'byUser') {
    const lines = result.rows.length
      ? result.rows.map((r, i) => (i + 1) + '. <@' + r.discordId + '> — ' + r.count)
      : ['No data.'];
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Top Attendees', description: lines.join('\n') })],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (mode === 'byType') {
    const lines = result.rows.length
      ? result.rows.map((r) => '`' + r._id + '` — ' + r.count)
      : ['No data.'];
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Attendance by Event Type', description: lines.join('\n') })],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (mode === 'byWeek') {
    const lines = result.rows.length
      ? result.rows.map((r) => r._id.year + '-W' + String(r._id.week).padStart(2, '0') + ' — ' + r.count)
      : ['No data.'];
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({ title: 'Attendance by ISO Week', description: lines.join('\n') })],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function startAddFlow(interaction, ctx) {
  await assertPermission(interaction, 'attendance.manage');
  sessions.startSession('attendance:add', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('attendance:add:user')
    .setPlaceholder('Select the user to add')
    .setMinValues(1).setMaxValues(1);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Add Attendance — Step 1 of 3',
      description: 'Select the Discord user you want to add to an event.',
    })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function startRemoveFlow(interaction, ctx) {
  await assertPermission(interaction, 'attendance.manage');
  sessions.startSession('attendance:remove', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('attendance:remove:user')
    .setPlaceholder('Select the user to remove')
    .setMinValues(1).setMaxValues(1);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Remove Attendance — Step 1 of 3',
      description: 'Select the Discord user you want to remove from an event.',
    })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function assertPermission(interaction, permissionKey) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission to perform this action.');
  const ok = await permissionService.hasPermission(user.id, permissionKey);
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');
}

export const HANDLERS = {
  view: handleView,
  history: handleHistory,
  stats: handleStats,
  add: startAddFlow,
  remove: startRemoveFlow,
};
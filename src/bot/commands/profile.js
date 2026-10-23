
import {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';

import * as userService from '../../services/user.service.js';
import * as statisticsService from '../../services/statistics.service.js';
import * as strikeService from '../../services/strike.service.js';
import * as leaveService from '../../services/leave.service.js';
import * as noticeService from '../../services/notice.service.js';

import * as roleAssignmentRepo from '../../db/repositories/roleAssignment.repository.js';
import * as quotaResultRepo from '../../db/repositories/quotaResult.repository.js';
import * as attendanceRepo from '../../db/repositories/attendance.repository.js';
import * as rankHistoryRepo from '../../db/repositories/rankHistory.repository.js';
import * as userRepo from '../../db/repositories/user.repository.js';

import * as permissionService from '../../services/permission.service.js';

import { infoEmbed } from '../embedBuilders.js';
import logger from '../../config/logger.js';

// ============================================================
// DESIGN SYSTEM
// ============================================================

const THEME = {
  primary: 0x26374A,
  surface: 0x34495E,
  muted: 0x64748B,
  success: 0x477D68,
  warning: 0xB68B45,
  danger: 0xA65353,
};

const BRAND = '24th Guard Rifles';
const DASHBOARD = 'PERSONNEL MANAGEMENT SYSTEM';

// ============================================================
// SLASH COMMAND
// ============================================================

export const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('View a personnel profile dashboard.')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('View another member’s profile (staff only)')
      .setRequired(false)
  )
  .toJSON();

export const meta = {};

// ============================================================
// EXECUTION
// ============================================================

export async function execute(interaction, ctx) {
  const requestedUser = interaction.options.getUser('user');
  const targetDiscordId = requestedUser?.id ?? interaction.user.id;
  const isSelf = targetDiscordId === interaction.user.id;

  if (!isSelf) {
    const allowed = await permissionService.hasPermission(
      ctx.user.id,
      'users.view'
    );

    if (!allowed) {
      return interaction.reply({
        embeds: [
          infoEmbed({
            title: 'Access Denied',
            description: 'You do not have permission to view other members’ profiles.',
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  try {
    // Resolve the internal user record once, rather than repeatedly
    // querying the repository for the same Discord ID.
    const registeredUser = await userRepo
      .findByDiscordId(targetDiscordId)
      .catch((error) => {
        logger.error(
          { error, targetDiscordId },
          'Failed to resolve profile user record'
        );
        return null;
      });

    const internalUserId = registeredUser?.id;

    const [
      profile,
      stats,
      activeStrikes,
      strikeHistory,
      activeLeave,
      activeNotices,
      assignments,
      recentQuota,
      recentAttendance,
      recentRank,
    ] = await Promise.all([
      userService.getMemberProfile(targetDiscordId),
      statisticsService.userStats(targetDiscordId).catch(() => null),
      strikeService.getActiveStrikes(targetDiscordId).catch(() => []),
      strikeService
        .getStrikeHistory(targetDiscordId, { limit: 5 })
        .catch(() => []),
      leaveService
        .getActiveLeaveForUser(targetDiscordId)
        .catch(() => null),
      noticeService
        .getActiveNoticesForUser(targetDiscordId)
        .catch(() => []),
      internalUserId
        ? roleAssignmentRepo.findActiveForUser(internalUserId).catch(() => [])
        : Promise.resolve([]),
      internalUserId
        ? quotaResultRepo
            .recentForUser(internalUserId, { limit: 6 })
            .catch(() => [])
        : Promise.resolve([]),
      attendanceRepo
        .historyForDiscordId(targetDiscordId, { limit: 6 })
        .catch(() => []),
      internalUserId
        ? rankHistoryRepo
            .listForUser(internalUserId, { limit: 3 })
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    if (!profile) {
      return interaction.editReply({
        embeds: [
          infoEmbed({
            title: 'Personnel Record Not Found',
            description:
              `<@${targetDiscordId}> is not registered with the personnel system.`,
          }),
        ],
      });
    }

    const user = profile.user;
    const displayName =
      user.discord_username ||
      requestedUser?.username ||
      interaction.user.username;

    // Use the target member's avatar when Discord has supplied the user.
    const avatarURL =
      requestedUser?.displayAvatarURL() ??
      (!requestedUser && isSelf
        ? interaction.user.displayAvatarURL()
        : undefined);

    const embeds = [];

    embeds.push(
      buildIdentityEmbed({
        user,
        profile,
        displayName,
        avatarURL,
        assignments,
      })
    );

    embeds.push(
      buildActivityEmbed({
        stats,
        recentAttendance,
        recentRank,
      })
    );

    embeds.push(
      buildDisciplineEmbed({
        user,
        activeStrikes,
        strikeHistory,
        recentQuota,
      })
    );

    embeds.push(
      buildStatusEmbed({
        activeLeave,
        activeNotices,
      })
    );

    return interaction.editReply({ embeds });
  } catch (error) {
    logger.error(
      { error, targetDiscordId },
      'Failed to generate personnel profile dashboard'
    );

    return interaction.editReply({
      embeds: [
        infoEmbed({
          title: 'Dashboard Unavailable',
          description:
            'The personnel dashboard could not be generated. Please try again later.',
        }),
      ],
    });
  }
}

// ============================================================
// EMBED 1: PERSONNEL OVERVIEW
// ============================================================

function buildIdentityEmbed({
  user,
  profile,
  displayName,
  avatarURL,
  assignments,
}) {
  const embed = new EmbedBuilder()
    .setColor(THEME.primary)
    .setTitle('PERSONNEL RECORD')
    .setDescription(
      [
        `**${escapeMarkdown(displayName)}**`,
        `\`${user.discord_id}\``,
        '',
        `*${DASHBOARD}*`,
      ].join('\n')
    )
    .addFields(
      {
        name: 'DISCORD ACCOUNT',
        value: `<@${user.discord_id}>`,
        inline: true,
      },
      {
        name: 'ROBLOX ACCOUNT',
        value: user.roblox_username
          ? `**${escapeMarkdown(user.roblox_username)}**\nID: \`${user.roblox_id ?? 'Not recorded'}\``
          : 'Not linked',
        inline: true,
      },
      {
        name: 'PERSONNEL STATUS',
        value: formatStatus(user.status),
        inline: true,
      }
    );

  if (user.roblox_rank_name) {
    embed.addFields({
      name: 'ROBLOX RANK',
      value:
        `**${escapeMarkdown(user.roblox_rank_name)}**` +
        (user.roblox_rank_value != null
          ? `\nRank value: \`${user.roblox_rank_value}\``
          : ''),
      inline: true,
    });
  }

  if (user.roblox_last_synced_at) {
    embed.addFields({
      name: 'LAST GROUP SYNC',
      value: formatTimestamp(user.roblox_last_synced_at),
      inline: true,
    });
  }

  if (user.joined_at) {
    embed.addFields({
      name: 'REGISTERED',
      value: formatTimestamp(user.joined_at),
      inline: true,
    });
  }

  const internalRoles = (profile.roles ?? [])
    .map((role) => role.key)
    .filter(Boolean);

  // Repository assignments are retained as a fallback if the profile's
  // role list is empty. Adjust the field mapping if your schema differs.
  const roleNames = internalRoles.length
    ? internalRoles
    : assignments.map((assignment) => assignment.role_key).filter(Boolean);

  embed.addFields({
    name: `INTERNAL ROLES (${roleNames.length})`,
    value: roleNames.length
      ? truncate(
          roleNames.map((role) => `\`${escapeInlineCode(role)}\``).join('  |  '),
          1024
        )
      : 'No internal roles assigned',
    inline: false,
  });

  if (avatarURL) {
    embed.setThumbnail(avatarURL);
  }

  return embed
    .setFooter({ text: `${BRAND} • Personnel Records` })
    .setTimestamp();
}

// ============================================================
// EMBED 2: ACTIVITY & PERFORMANCE
// ============================================================

function buildActivityEmbed({
  stats,
  recentAttendance,
  recentRank,
}) {
  const activity = stats?.activity;

  const embed = new EmbedBuilder()
    .setColor(THEME.primary)
    .setTitle('ACTIVITY & PERFORMANCE')
    .setDescription(
      'Recorded participation, event hosting, and rank progression.'
    )
    .addFields(
      {
        name: 'EVENTS HOSTED',
        value: `**${formatNumber(activity?.totalEventsHosted)}**`,
        inline: true,
      },
      {
        name: 'EVENTS ATTENDED',
        value: `**${formatNumber(activity?.totalEventsAttended)}**`,
        inline: true,
      },
      {
        name: 'RANK CHANGES',
        value: `**${formatNumber(activity?.rankChanges)}**`,
        inline: true,
      }
    );

  if (!stats) {
    embed.addFields({
      name: 'STATISTICS',
      value: 'Activity statistics are currently unavailable.',
      inline: false,
    });
  }

  const attendanceLines = recentAttendance.slice(0, 6).map((record) => {
    const state = record.active ? 'ACTIVE' : 'REMOVED';
    const eventType = escapeInlineCode(record.event_type_key || 'UNKNOWN');

    return `\`${state.padEnd(7)}\`  \`${eventType}\`  ${formatTimestamp(record.event_at)}`;
  });

  embed.addFields({
    name: 'RECENT ATTENDANCE',
    value: attendanceLines.length
      ? attendanceLines.join('\n').slice(0, 1024)
      : 'No attendance records available.',
    inline: false,
  });

  const rankLines = recentRank.slice(0, 3).map((record) => {
    const oldRank = record.old_rank_name || 'Unrecorded';
    const newRank = record.new_rank_name || 'Unrecorded';

    return [
      `**${escapeMarkdown(oldRank)}** → **${escapeMarkdown(newRank)}**`,
      formatTimestamp(record.changed_at),
    ].join('\n');
  });

  embed.addFields({
    name: 'RECENT RANK PROGRESSION',
    value: rankLines.length
      ? rankLines.join('\n\n').slice(0, 1024)
      : 'No rank changes recorded.',
    inline: false,
  });

  return embed.setFooter({
    text: `${BRAND} • Activity Records`,
  });
}

// ============================================================
// EMBED 3: QUOTA & DISCIPLINARY RECORD
// ============================================================

function buildDisciplineEmbed({
  user,
  activeStrikes,
  strikeHistory,
  recentQuota,
}) {
  const quotaCategory = user.quota_category || 'NONE';

  const embed = new EmbedBuilder()
    .setColor(activeStrikes.length ? THEME.warning : THEME.primary)
    .setTitle('QUOTA & DISCIPLINARY RECORD')
    .setDescription('Quota compliance and current disciplinary standing.')
    .addFields(
      {
        name: 'QUOTA CATEGORY',
        value: `\`${escapeInlineCode(quotaCategory)}\``,
        inline: true,
      },
      {
        name: 'QUOTA EXEMPTION',
        value: user.quota_exempt
          ? 'EXEMPT'
          : 'NOT EXEMPT',
        inline: true,
      },
      {
        name: 'ACTIVE STRIKES',
        value: `**${activeStrikes.length}**`,
        inline: true,
      }
    );

  if (user.quota_exempt && user.quota_exempt_reason) {
    embed.addFields({
      name: 'EXEMPTION REASON',
      value: truncate(user.quota_exempt_reason, 1024),
      inline: false,
    });
  }

  const quotaLines = recentQuota.slice(0, 6).map((record) => {
    const status = String(record.status || 'UNKNOWN').toUpperCase();
    const period = escapeInlineCode(record.period_key || 'UNKNOWN');

    const progress =
      status === 'MET' || status === 'MISSED'
        ? `  ${formatNumber(record.actual_amount)} / ${formatNumber(record.required_amount)}`
        : '';

    return `\`${status.padEnd(7)}\`  \`${period}\`${progress}`;
  });

  embed.addFields({
    name: 'RECENT QUOTA RESULTS',
    value: quotaLines.length
      ? quotaLines.join('\n').slice(0, 1024)
      : 'No quota results recorded.',
    inline: false,
  });

  const strikeLines = activeStrikes.slice(0, 5).map((strike) => {
    const type = escapeInlineCode(strike.type || 'GENERAL');
    const period = strike.quota_period_key
      ? `\nPeriod: \`${escapeInlineCode(strike.quota_period_key)}\``
      : '';
    const reason = strike.reason
      ? `\n${truncate(strike.reason, 250)}`
      : '';

    return `**${type}**${period}${reason}`;
  });

  embed.addFields({
    name: 'CURRENT DISCIPLINARY ACTIONS',
    value: strikeLines.length
      ? strikeLines.join('\n\n').slice(0, 1024)
      : 'No active strikes.',
    inline: false,
  });

  const historyLines = strikeHistory.slice(0, 5).map((strike) => {
    const type = escapeInlineCode(strike.type || 'GENERAL');
    const status = String(strike.status || 'UNKNOWN').toUpperCase();

    return `\`${status.padEnd(10)}\`  \`${type}\``;
  });

  embed.addFields({
    name: 'DISCIPLINARY HISTORY',
    value: historyLines.length
      ? historyLines.join('\n')
      : 'No disciplinary history recorded.',
    inline: false,
  });

  return embed.setFooter({
    text: `${BRAND} • Compliance Records`,
  });
}

// ============================================================
// EMBED 4: LEAVE & NOTICES
// ============================================================

function buildStatusEmbed({
  activeLeave,
  activeNotices,
}) {
  const embed = new EmbedBuilder()
    .setColor(THEME.primary)
    .setTitle('LEAVE & ADMINISTRATIVE NOTICES')
    .setDescription(
      'Current approved time off and administrative notices.'
    );

  if (activeLeave) {
    const leaveFields = [
      `**End date:** ${formatDate(activeLeave.end_at)}`,
      `**Reason:** ${truncate(activeLeave.reason || 'Not specified', 700)}`,
    ];

    embed.addFields({
      name: 'ACTIVE LEAVE',
      value: leaveFields.join('\n'),
      inline: false,
    });
  } else {
    embed.addFields({
      name: 'ACTIVE LEAVE',
      value: 'No active leave recorded.',
      inline: false,
    });
  }

  const noticeLines = activeNotices.slice(0, 5).map((notice) => {
    const type = escapeInlineCode(notice.type || 'GENERAL');
    const endDate = notice.end_at
      ? formatDate(notice.end_at)
      : 'No expiry recorded';

    const exemption = notice.grants_quota_exemption
      ? 'Quota exemption: YES'
      : 'Quota exemption: NO';

    const reason = truncate(notice.reason || 'Not specified', 250);

    return [
      `**${type}**`,
      `Expiry: ${endDate}`,
      exemption,
      `Reason: ${reason}`,
    ].join('\n');
  });

  embed.addFields({
    name: `ACTIVE NOTICES (${activeNotices.length})`,
    value: noticeLines.length
      ? noticeLines.join('\n\n').slice(0, 1024)
      : 'No active administrative notices.',
    inline: false,
  });

  return embed
    .setFooter({
      text: `${BRAND} • Administrative Records`,
    })
    .setTimestamp();
}

// ============================================================
// PRESENTATION HELPERS
// ============================================================

function formatStatus(status) {
  const labels = {
    ACTIVE: 'ACTIVE',
    UNVERIFIED: 'UNVERIFIED',
    LEFT_ROBLOX_GROUP: 'LEFT GROUP',
    SUSPENDED: 'SUSPENDED',
    INACTIVE: 'INACTIVE',
  };

  return `\`${labels[status] || status || 'UNKNOWN'}\``;
}

function formatTimestamp(value) {
  const date = validDate(value);

  if (!date) return 'Not recorded';

  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

function formatDate(value) {
  const date = validDate(value);

  if (!date) return 'Not recorded';

  return `<t:${Math.floor(date.getTime() / 1000)}:d>`;
}

function validDate(value) {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatNumber(value) {
  const number = Number(value ?? 0);

  return Number.isFinite(number)
    ? number.toLocaleString('en-US')
    : '0';
}

function truncate(value, maxLength = 1024) {
  const text = String(value ?? '');

  if (text.length <= maxLength) return text;

  return `${text.slice(0, maxLength - 3)}...`;
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(
    /([\\`*_{}[\]()<>#+\-.!|~])/g,
    '\\$1'
  );
}

function escapeInlineCode(value) {
  return String(value ?? '')
    .replace(/`/g, 'ˋ')
    .replace(/[\r\n]/g, ' ');
}

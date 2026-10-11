import {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as leaveService from '../../services/leave.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import { paginate } from '../components/pagination.js';
import * as sessions from '../sessions.js';
import { formatDateRange, formatRelative, resolveUsernames, truncatePlain } from '../utils/format.js';

export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Leave requests and approvals.')
  .addSubcommand((sub) =>
    sub.setName('create').setDescription('Submit a leave request.')
  )
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('View leave history for a user.')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Target user (default: yourself)')
      )
  )
  .addSubcommand((sub) =>
    sub.setName('active').setDescription('List currently active approved leaves.')
  )
  .addSubcommand((sub) =>
    sub.setName('approve').setDescription('Approve a pending leave request.')
  )
  .addSubcommand((sub) =>
    sub.setName('reject').setDescription('Reject a pending leave request.')
  )
  .addSubcommand((sub) =>
    sub.setName('end').setDescription('End an approved leave early.')
  )
  .addSubcommand((sub) =>
    sub.setName('cancel').setDescription('Cancel your own pending leave request.')
  )
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'create':  return handleCreate(interaction);
    case 'view':    return handleView(interaction);
    case 'active':  return handleActive(interaction);
    case 'approve': return startApproveFlow(interaction);
    case 'reject':  return startRejectFlow(interaction);
    case 'end':     return startEndFlow(interaction);
    case 'cancel':  return handleCancel(interaction);
    default:
      throw new Error('Unknown /leave subcommand: ' + sub);
  }
}

// ============================================================
//  create
// ============================================================

async function handleCreate(interaction) {
  await assertPermission(interaction, 'leave.create');

  const modal = new ModalBuilder()
    .setCustomId('modal:leave-create')
    .setTitle('Submit Leave Request');

  const startInput = new TextInputBuilder()
    .setCustomId('startAt')
    .setLabel('Start date (YYYY-MM-DD)')
    .setPlaceholder('e.g. 2026-10-15')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10);

  const endInput = new TextInputBuilder()
    .setCustomId('endAt')
    .setLabel('End date (YYYY-MM-DD)')
    .setPlaceholder('e.g. 2026-10-22')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10);

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason')
    .setPlaceholder('Why you need leave')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(startInput),
    new ActionRowBuilder().addComponents(endInput),
    new ActionRowBuilder().addComponents(reasonInput)
  );

  return interaction.showModal(modal);
}

// ============================================================
//  view
// ============================================================

async function handleView(interaction) {
  await assertPermission(interaction, 'leave.view');
  const target = interaction.options.getUser('user') || interaction.user;

  const result = await leaveService.listLeaves({ discordId: target.id, pageSize: 20 });

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Leave History',
        description: '<@' + target.id + '> has no leave records.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = result.items.map((l) => {
    const start = Math.floor(new Date(l.startAt).getTime() / 1000);
    const end = Math.floor(new Date(l.endAt).getTime() / 1000);
    const emoji = {
      PENDING: '🟡',
      APPROVED: '🟢',
      REJECTED: '🔴',
      EXPIRED: '⚫',
      CANCELLED: '⚪',
    }[l.status] || '⚪';
    return emoji + ' <t:' + start + ':d> → <t:' + end + ':d> — **' + l.status + '**' +
           (l.reason ? '\n  _' + l.reason + '_' : '');
  });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Leave History for ' + target.username,
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  active
// ============================================================

async function handleActive(interaction) {
  await assertPermission(interaction, 'leave.view');

  const result = await leaveService.listLeaves({ status: 'APPROVED', pageSize: 100 });
  const now = new Date();
  const active = result.items.filter(
    (l) => new Date(l.startAt) <= now && new Date(l.endAt) >= now
  );

  if (active.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Active Leaves',
        description: 'No members are currently on approved leave.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = active.map((l) => {
    const end = Math.floor(new Date(l.endAt).getTime() / 1000);
    return '• <@' + l.discordId + '> — until <t:' + end + ':d> — ' + l.reason;
  });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Active Leaves (' + active.length + ')',
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  approve / reject / end — picker-driven
// ============================================================

async function startApproveFlow(interaction) {
  await assertPermission(interaction, 'leave.approve');
  return showLeavePicker(interaction, 'PENDING', 'leave:approve:request', 'Approve Leave');
}

async function startRejectFlow(interaction) {
  await assertPermission(interaction, 'leave.reject');
  return showLeavePicker(interaction, 'PENDING', 'leave:reject:request', 'Reject Leave');
}

async function startEndFlow(interaction) {
  await assertPermission(interaction, 'leave.manage');
  return showLeavePicker(interaction, 'APPROVED', 'leave:end:request', 'End Leave');
}

async function showLeavePicker(interaction, status, customId, title) {
  const result = await leaveService.listLeaves({ status, pageSize: 25 });

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No ' + status + ' Leaves',
        description: 'There are no ' + status.toLowerCase() + ' leave requests.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Bulk-resolve usernames (cache-friendly, no ObjectIds leaked).
  const usernames = await resolveUsernames(
    interaction.client,
    result.items.map((l) => l.discordId)
  );

  const options = result.items.map((l) => {
    const username = usernames.get(l.discordId) || 'unknown user';
    const period = formatDateRange(l.startAt, l.endAt);
    const submittedAgo = formatRelative(l.createdAt);
    const reasonSnippet = truncatePlain(l.reason || 'no reason', 60);

    // Label max 100 chars: "@username"
    const label = ('@' + username).slice(0, 100);

    // Description max 100 chars: "10 → 17 Oct 2026 · submitted 2 hours ago · reason"
    const description = truncatePlain(
      period + ' · submitted ' + submittedAgo + ' · ' + reasonSnippet,
      100
    );

    return {
      label,
      description,
      value: String(l._id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select a leave request')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: title,
      description: '**' + result.total + '** ' + status.toLowerCase() +
        ' request(s). Select the one you want to act on.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  cancel — self-service
// ============================================================

async function handleCancel(interaction) {
  const result = await leaveService.listLeaves({
    status: 'PENDING',
    discordId: interaction.user.id,
    pageSize: 5,
  });

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Pending Leave',
        description: 'You do not have a pending leave request to cancel.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (result.total === 1) {
    const leave = result.items[0];
    await leaveService.cancelLeave(interaction.user.id, leave._id, {
      reason: 'Cancelled by requester',
    });
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Leave Cancelled',
        description: 'Your pending leave request has been cancelled.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Multiple pending leaves — extremely rare, but handle it.
  const options = result.items.map((l) => {
    const period = formatDateRange(l.startAt, l.endAt);
    const submittedAgo = formatRelative(l.createdAt);
    return {
      label: truncatePlain('Requested ' + submittedAgo, 100),
      description: truncatePlain(period + ' · ' + (l.reason || 'no reason'), 100),
      value: String(l._id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('leave:self:cancel')
    .setPlaceholder('Select a leave to cancel')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Cancel Leave',
      description: 'Select the pending leave you want to cancel.',
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
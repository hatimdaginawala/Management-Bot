import {
  SlashCommandBuilder,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import * as noticeService from '../../services/notice.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';

export const data = new SlashCommandBuilder()
  .setName('notice')
  .setDescription('Notices and inactivity records.')
  .addSubcommand((sub) =>
    sub.setName('create').setDescription('Create a notice for a user.')
  )
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('View active notices for a user.')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Target user').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('cancel').setDescription('Cancel an active notice.')
  )
  .addSubcommand((sub) =>
    sub.setName('active').setDescription('List all active notices.')
  )
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'create': return startCreateFlow(interaction);
    case 'view':   return handleView(interaction);
    case 'cancel': return startCancelFlow(interaction);
    case 'active': return handleActive(interaction);
    case 'extend':             return startExtendFlow(interaction);
    case 'approve-extension':  return handleApproveExtension(interaction);
    case 'reject-extension':   return handleRejectExtension(interaction);
    default:
      throw new Error('Unknown /notice subcommand: ' + sub);
  }
}

// ============================================================
//  create (user picker → modal)
// ============================================================

async function startCreateFlow(interaction) {
  await assertPermission(interaction, 'notice.create');

  sessions.startSession('notice:create', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('notice:create:user')
    .setPlaceholder('Select the user to notify')
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Create Notice — Step 1 of 2',
      description: 'Select the Discord user you want to create a notice for.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  view
// ============================================================

async function handleView(interaction) {
  await assertPermission(interaction, 'notice.view');
  const target = interaction.options.getUser('user', true);

  const active = await noticeService.getActiveNoticesForUser(target.id);

  if (active.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Active Notices',
        description: '<@' + target.id + '> has no active notices.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = active.map((n) => {
    const start = Math.floor(new Date(n.startAt).getTime() / 1000);
    const end = n.endAt ? '<t:' + Math.floor(new Date(n.endAt).getTime() / 1000) + ':d>' : 'open-ended';
    const exempt = n.grantsQuotaExemption ? ' — *exempt*' : '';
    return '• `' + n.type + '` — <t:' + start + ':R> until ' + end + exempt + '\n  ' + n.reason;
  });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Active Notices for ' + target.username,
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  cancel (picker → modal)
// ============================================================

async function startCancelFlow(interaction) {
  await assertPermission(interaction, 'notice.manage');

  const result = await noticeService.listNotices({ status: 'ACTIVE', pageSize: 25 });

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Active Notices',
        description: 'There are no active notices to cancel.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const { resolveUsernames, formatRelative, truncatePlain } = await import('../utils/format.js');
  const usernames = await resolveUsernames(
    interaction.client,
    result.items.map((n) => n.discordId)
  );

  const options = result.items.map((n) => {
    const username = usernames.get(n.discordId) || 'unknown user';
    const issuedAgo = formatRelative(n.startAt);
    const exempt = n.grantsQuotaExemption ? ' · exempt' : '';

    const label = truncatePlain('@' + username + ' — ' + n.type, 100);
    const description = truncatePlain(
      'issued ' + issuedAgo + exempt + ' · ' + (n.reason || 'no reason'),
      100
    );

    return { label, description, value: String(n._id) };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('notice:cancel:notice')
    .setPlaceholder('Select a notice to cancel')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Cancel Notice',
      description: '**' + result.total + '** active notice(s). Select one to cancel.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  active
// ============================================================

async function handleActive(interaction) {
  await assertPermission(interaction, 'notice.view');

  const result = await noticeService.listNotices({ status: 'ACTIVE', pageSize: 25 });

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Active Notices',
        description: 'There are no active notices.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = result.items.map((n) => {
    const start = Math.floor(new Date(n.startAt).getTime() / 1000);
    const exempt = n.grantsQuotaExemption ? ' 🟢' : '';
    return '• <@' + n.discordId + '> — `' + n.type + '`' + exempt + ' — <t:' + start + ':R>';
  });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Active Notices (' + result.total + ')',
      description: lines.join('\n'),
    })],
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
}async function startExtendFlow(interaction) {
  // Show picker of the user's own ACTIVE notices
  const { Notice } = await import('../../models/index.js');
  const ownNotices = await Notice.find({
    discordId: interaction.user.id,
    status: 'ACTIVE',
  }).lean();

  if (ownNotices.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Active Notices',
        description: 'You have no active notices to extend.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = ownNotices.slice(0, 25).map((n) => {
    const endStr = n.endAt ? new Date(n.endAt).toISOString().slice(0, 10) : 'open-ended';
    return {
      label: ('Notice: ' + n.type).slice(0, 100),
      description: ('Ends ' + endStr + ' — ' + (n.reason || 'no reason')).slice(0, 100),
      value: String(n._id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('notice:extend:notice')
    .setPlaceholder('Select a notice to extend')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Request Notice Extension',
      description: 'Select the notice you want to extend.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleApproveExtension(interaction) {
  await assertPermission(interaction, 'notice.manage');

  const { Notice } = await import('../../models/index.js');
  const pending = await Notice.find({ 'pendingExtension.status': 'PENDING' }).limit(25).lean();

  if (pending.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Pending Extensions',
        description: 'There are no pending notice extensions to approve.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = pending.map((n) => {
    const newEnd = new Date(n.pendingExtension.newEndAt).toISOString().slice(0, 10);
    const requestedAgo = Math.floor((Date.now() - new Date(n.pendingExtension.requestedAt).getTime()) / 60000);
    return {
      label: ('@' + (n.discordId || 'unknown') + ' — ' + n.type).slice(0, 100),
      description: ('New end ' + newEnd + ' — requested ' + requestedAgo + ' min ago').slice(0, 100),
      value: String(n._id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('notice:extension:approve:request')
    .setPlaceholder('Select a pending extension')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Approve Notice Extension',
      description: '**' + pending.length + '** pending request(s). Select one to approve.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRejectExtension(interaction) {
  await assertPermission(interaction, 'notice.manage');

  const { Notice } = await import('../../models/index.js');
  const pending = await Notice.find({ 'pendingExtension.status': 'PENDING' }).limit(25).lean();

  if (pending.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Pending Extensions',
        description: 'There are no pending notice extensions to reject.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = pending.map((n) => {
    const newEnd = new Date(n.pendingExtension.newEndAt).toISOString().slice(0, 10);
    return {
      label: ('@' + (n.discordId || 'unknown') + ' — ' + n.type).slice(0, 100),
      description: ('Requested new end ' + newEnd).slice(0, 100),
      value: String(n._id),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('notice:extension:reject:request')
    .setPlaceholder('Select a pending extension')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Reject Notice Extension',
      description: '**' + pending.length + '** pending request(s). Select one to reject.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}
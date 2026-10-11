import {
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import * as permissionService from '../../services/permission.service.js';
import { User, SyncLog } from '../../models/index.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed, successEmbed } from '../embedBuilders.js';
import { runJobByName } from '../../jobs/runner.js';

export const data = new SlashCommandBuilder()
  .setName('sync')
  .setDescription('Roblox group synchronization.')
  .addSubcommand((sub) =>
    sub.setName('roblox').setDescription('Trigger a manual Roblox group sync.')
  )
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('Show the last Roblox sync.')
  )
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'roblox':  return handleTrigger(interaction);
    case 'status':  return handleStatus(interaction);
    default:
      throw new Error('Unknown /sync subcommand: ' + sub);
  }
}

// ============================================================
//  roblox — fire-and-forget
// ============================================================

async function handleTrigger(interaction) {
  await assertPermission(interaction, 'roblox.sync');

  const result = runJobByName('roblox-sync', { triggeredBy: interaction.user.id });

  if (!result.started) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Sync Not Started',
        description: 'A sync is already running. Try again after it completes.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.reply({
    embeds: [successEmbed({
      title: 'Sync Started',
      description:
        'Roblox group sync has been triggered. It runs in the background.\n' +
        'Use `/sync status` to see the result when it finishes (usually under a minute).',
    })],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  status
// ============================================================

async function handleStatus(interaction) {
  await assertPermission(interaction, 'roblox.view');

  const latest = await SyncLog.findOne({ type: 'ROBLOX_GROUP_SYNC' })
    .sort({ startedAt: -1 })
    .lean();

  if (!latest) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Syncs Yet',
        description: 'The Roblox group has not been synced yet.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const startTs = Math.floor(new Date(latest.startedAt).getTime() / 1000);
  const endTs = latest.completedAt
    ? Math.floor(new Date(latest.completedAt).getTime() / 1000)
    : null;

  const fields = [
    { name: 'Status', value: '`' + latest.status + '`', inline: true },
    { name: 'Triggered By', value: '`' + latest.triggeredBy + '`', inline: true },
    { name: 'Started', value: '<t:' + startTs + ':R>', inline: true },
  ];

  if (endTs) {
    fields.push({ name: 'Completed', value: '<t:' + endTs + ':R>', inline: true });
  }

  fields.push(
    { name: 'Members Fetched', value: String(latest.membersFetched || 0), inline: true },
    { name: 'Created', value: String(latest.membersCreated || 0), inline: true },
    { name: 'Updated', value: String(latest.membersUpdated || 0), inline: true },
    { name: 'Rank Changes', value: String(latest.rankChanges || 0), inline: true },
    { name: 'Left Group', value: String(latest.membersRemoved || 0), inline: true }
  );

  if (Array.isArray(latest.capturedErrors) && latest.capturedErrors.length > 0) {
    fields.push({
      name: 'Errors (' + latest.capturedErrors.length + ')',
      value: latest.capturedErrors
        .slice(0, 5)
        .map((e) => '• ' + (e.message || 'unknown'))
        .join('\n')
        .slice(0, 1000),
      inline: false,
    });
  }

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Roblox Sync Status',
      fields,
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
}
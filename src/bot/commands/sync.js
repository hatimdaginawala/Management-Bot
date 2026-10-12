import {
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import * as syncLogRepo from '../../db/repositories/syncLog.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed, successEmbed } from '../embedBuilders.js';
import { runJobByName } from '../../jobs/runner.js';

export const data = new SlashCommandBuilder()
  .setName('sync')
  .setDescription('Roblox group synchronization.')
  .addSubcommand((sub) => sub.setName('roblox').setDescription('Trigger a manual Roblox group sync.'))
  .addSubcommand((sub) => sub.setName('status').setDescription('Show the last Roblox sync.'))
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

async function handleTrigger(interaction) {
  await assertPermission(interaction, 'roblox.sync');

  const result = runJobByName('roblox-sync', {
    triggeredBy: interaction.user.id,
    client: interaction.client,
  });

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

async function handleStatus(interaction) {
  await assertPermission(interaction, 'roblox.view');

  const latest = await syncLogRepo.findLatest('ROBLOX_GROUP_SYNC');

  if (!latest) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'No Syncs Yet', description: 'The Roblox group has not been synced yet.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const startTs = Math.floor(new Date(latest.started_at).getTime() / 1000);
  const endTs = latest.completed_at
    ? Math.floor(new Date(latest.completed_at).getTime() / 1000)
    : null;

  const fields = [
    { name: 'Status', value: '`' + latest.status + '`', inline: true },
    { name: 'Triggered By', value: '`' + latest.triggered_by + '`', inline: true },
    { name: 'Started', value: '<t:' + startTs + ':R>', inline: true },
  ];

  if (endTs) fields.push({ name: 'Completed', value: '<t:' + endTs + ':R>', inline: true });

  fields.push(
    { name: 'Members Fetched', value: String(latest.members_fetched || 0), inline: true },
    { name: 'Created', value: String(latest.members_created || 0), inline: true },
    { name: 'Updated', value: String(latest.members_updated || 0), inline: true },
    { name: 'Rank Changes', value: String(latest.rank_changes || 0), inline: true },
    { name: 'Left Group', value: String(latest.members_removed || 0), inline: true }
  );

  const errors = Array.isArray(latest.captured_errors) ? latest.captured_errors : [];
  if (errors.length > 0) {
    fields.push({
      name: 'Errors (' + errors.length + ')',
      value: errors.slice(0, 5).map((e) => '• ' + (e.message || 'unknown')).join('\n').slice(0, 1000),
      inline: false,
    });
  }

  return interaction.reply({
    embeds: [infoEmbed({ title: 'Roblox Sync Status', fields })],
    flags: MessageFlags.Ephemeral,
  });
}

async function assertPermission(interaction, permissionKey) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission to perform this action.');
  const ok = await permissionService.hasPermission(user.id, permissionKey);
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');
}
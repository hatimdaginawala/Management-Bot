import { syncGroup } from '../services/robloxSync.service.js';
import * as settingsService from '../services/settings.service.js';
import { EmbedBuilder } from 'discord.js';
import { COLORS } from '../bot/embedBuilders.js';
import logger from '../config/logger.js';

export const name = 'roblox-sync';

export async function run({ triggeredBy = 'system', client = null } = {}) {
  // Respect the runtime toggle.
  const settings = await settingsService.getSettings();
  if (settings?.roblox?.syncEnabled === false) {
    logger.info({ job: name }, 'Roblox sync disabled in settings — skipping');
    return { skipped: true };
  }

  const result = await syncGroup({ triggeredBy });

  // If we have a client and a channel configured, post a summary.
  if (client) {
    await postSyncSummary(client, result).catch((err) =>
      logger.debug({ err: err.message }, 'Sync summary post failed')
    );
  }

  return result;
}

async function postSyncSummary(client, result) {
  const settings = await settingsService.getSettings();
  const channelId = settings?.channels?.syncLogChannelId;
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) return;

  // Don't spam on ALREADY_RUNNING.
  if (result.status === 'ALREADY_RUNNING') return;

  // Only post on FAILED / PARTIAL. SUCCESS is silent by default.
  // (Change this condition if you want success posts too.)
  if (result.status !== 'FAILED' && result.status !== 'PARTIAL') return;

  const syncLog = result.syncLog;
  if (!syncLog) return;

  const color = result.status === 'FAILED' ? COLORS.ERROR : COLORS.WARNING;

  const fields = [
    { name: 'Status', value: '`' + result.status + '`', inline: true },
    { name: 'Triggered By', value: '`' + (syncLog.triggeredBy || 'system') + '`', inline: true },
    { name: 'Members Fetched', value: String(syncLog.membersFetched ?? 0), inline: true },
    { name: 'Created', value: String(syncLog.membersCreated ?? 0), inline: true },
    { name: 'Updated', value: String(syncLog.membersUpdated ?? 0), inline: true },
    { name: 'Rank Changes', value: String(syncLog.rankChanges ?? 0), inline: true },
    { name: 'Left Group', value: String(syncLog.membersRemoved ?? 0), inline: true },
  ];

  const errors = Array.isArray(syncLog.capturedErrors) ? syncLog.capturedErrors : [];
  if (errors.length > 0) {
    const shown = errors.slice(0, 5).map((e) => '• ' + (e.message || 'unknown'));
    fields.push({
      name: 'Errors (' + errors.length + ')',
      value: shown.join('\n').slice(0, 1000),
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('Roblox Sync ' + result.status)
    .addFields(fields)
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}
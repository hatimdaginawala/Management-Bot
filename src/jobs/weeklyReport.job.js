import * as reportService from '../services/report.service.js';
import * as settingsService from '../services/settings.service.js';
import * as reportRepo from '../db/repositories/report.repository.js';
import logger from '../config/logger.js';

export const name = 'weekly-report';

export async function run({ client = null, actorId = 'system' } = {}) {
  const report = await reportService.generateWeeklyReport({ generatedBy: actorId });

  if (!client) {
    logger.warn({ job: name, reportId: report.id }, 'No client — skipping post');
    return { report, posted: false };
  }

  const settings = await settingsService.getSettings();
  const channelId = settings?.channels?.reportChannelId;
  if (!channelId) {
    logger.info({ job: name, reportId: report.id }, 'No report channel configured');
    return { report, posted: false };
  }

  const posted = await postReportToChannel(client, report, channelId);
  return { report, posted };
}

/**
 * Send the report's rendered payload to the configured channel.
 * Returns true on success, false on any failure (logged).
 */
export async function postReportToChannel(client, report, channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased?.()) {
      logger.warn({ channelId }, 'Report channel not found or not text-based');
      return false;
    }

    const payload = report.rendered_payload_json ?? { content: 'Report payload missing.' };
    const message = await channel.send(payload);

    // Record where we posted, so re-posts can be detected.
    await reportRepo.setPosted(report.id, { channelId, messageId: message.id });

    logger.info(
      { channelId, messageId: message.id, reportId: report.id },
      'Weekly report posted'
    );
    return true;
  } catch (err) {
    logger.error(
      { err: err.message, channelId, reportId: report.id },
      'Failed to post weekly report'
    );
    return false;
  }
}
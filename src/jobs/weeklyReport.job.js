import { generateWeeklyReport } from '../services/report.service.js';
import { getSettings } from '../services/settings.service.js';
import logger from '../config/logger.js';

/**
 * Weekly report generation job.
 *
 * Generates the weekly report and, if `settings.channels.reportChannelId`
 * is configured, posts it. Posting requires a Discord client, which is
 * injected at runner start time.
 *
 * Scheduling and delivery are split: the report is always generated
 * and persisted, even if posting fails. A failed post leaves the report
 * in the DB with `channelId: null`, and Phase 19's `/report post` can
 * retry delivery.
 */
export const name = 'weekly-report';

export async function run({ client = null, actorId = 'system' } = {}) {
  const report = await generateWeeklyReport({ generatedBy: actorId });

  if (!client) {
    logger.warn({ job: name, reportId: String(report._id) }, 'No client — skipping post');
    return { report, posted: false };
  }

  const settings = await getSettings();
  const channelId = settings?.channels?.reportChannelId;
  if (!channelId) {
    logger.info({ job: name, reportId: String(report._id) }, 'No report channel configured');
    return { report, posted: false };
  }

  // Posting is delegated to a helper so Phase 19 can reuse it.
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
    const payload = report.renderedPayload ?? { content: 'Report payload missing.' };
    const message = await channel.send(payload);
    // Record where we posted, so re-posts can be detected.
    const { Report } = await import('../models/index.js');
    await Report.updateOne(
      { _id: report._id },
      { $set: { channelId, messageId: message.id } }
    );
    logger.info(
      { channelId, messageId: message.id, reportId: String(report._id) },
      'Weekly report posted'
    );
    return true;
  } catch (err) {
    logger.error(
      { err: err.message, channelId, reportId: String(report._id) },
      'Failed to post weekly report'
    );
    return false;
  }
}
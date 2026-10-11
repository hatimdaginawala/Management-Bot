import { EmbedBuilder } from 'discord.js';
import * as settingsService from '../../services/settings.service.js';
import { COLORS } from '../embedBuilders.js';
import logger from '../../config/logger.js';

/**
 * Central reporter for unexpected runtime errors.
 *
 * Posts to `settings.channels.auditChannelId`. Silently no-ops when the
 * channel is not configured. Debounces identical error messages over a
 * short window to prevent channel flooding.
 *
 * Contract: never throws. Reporters must not break the caller's flow.
 */

const recentlyReported = new Map(); // signature -> timestamp
const DEBOUNCE_MS = 30 * 1000;      // 30 seconds

/**
 * @param {Client} client
 * @param {Error|object} err
 * @param {object} [context]
 * @param {string} [context.source]    e.g. "interaction", "job", "service"
 * @param {string} [context.command]   command name
 * @param {string} [context.customId]  button/modal/select customId
 * @param {string} [context.userId]    Discord user ID
 * @param {string} [context.job]       job name
 * @param {object} [context.meta]      additional context
 */
export async function reportError(client, err, context = {}) {
  try {
    if (!client) return;

    const message = err?.message || String(err);
    const stack = err?.stack || null;
    const signature = buildSignature(message, context);

    // Debounce identical signatures.
    const last = recentlyReported.get(signature);
    const now = Date.now();
    if (last && now - last < DEBOUNCE_MS) {
      return;
    }
    recentlyReported.set(signature, now);

    // Bound the map.
    if (recentlyReported.size > 500) {
      const cutoff = now - DEBOUNCE_MS;
      for (const [k, t] of recentlyReported.entries()) {
        if (t < cutoff) recentlyReported.delete(k);
      }
    }

    const settings = await settingsService.getSettings();
    const channelId = settings?.channels?.auditChannelId;
    if (!channelId) {
      logger.debug({ signature }, 'errorReporter: no audit channel configured');
      return;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return;

    const fields = [];

    if (context.source) {
      fields.push({ name: 'Source', value: '`' + context.source + '`', inline: true });
    }
    if (context.command) {
      fields.push({ name: 'Command', value: '`/' + context.command + '`', inline: true });
    }
    if (context.job) {
      fields.push({ name: 'Job', value: '`' + context.job + '`', inline: true });
    }
    if (context.customId) {
      fields.push({ name: 'Interaction', value: '`' + context.customId + '`', inline: true });
    }
    if (context.userId) {
      fields.push({ name: 'User', value: '<@' + context.userId + '>', inline: true });
    }

    const truncatedStack = stack ? truncateForField(stack, 1000) : null;
    if (truncatedStack) {
      fields.push({ name: 'Stack', value: '```\n' + truncatedStack + '\n```', inline: false });
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('Bot Error')
      .setDescription('```\n' + message.slice(0, 400) + '\n```')
      .addFields(fields)
      .setTimestamp(new Date());

    await channel.send({ embeds: [embed] }).catch((sendErr) => {
      logger.debug({ err: sendErr.message }, 'errorReporter: send failed');
    });

    logger.info({ signature, channelId }, 'Error reported to audit channel');
  } catch (innerErr) {
    logger.warn({ err: innerErr.message }, 'errorReporter: internal failure (swallowed)');
  }
}

function buildSignature(message, context) {
  return [
    context.source || '',
    context.command || '',
    context.customId || '',
    context.job || '',
    message.slice(0, 120),
  ].join('|');
}

function truncateForField(text, max) {
  if (!text) return null;
  return text.length <= max ? text : text.slice(0, max - 20) + '\n…(truncated)';
}
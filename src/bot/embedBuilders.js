import { EmbedBuilder } from 'discord.js';
import { APP_NAME, APP_VERSION } from '../config/constants.js';

/**
 * Shared embed builders.
 *
 * Every command should use these so replies are visually consistent
 * and colors carry meaning.
 *
 * Colors:
 *   SUCCESS  green
 *   ERROR    red
 *   INFO     blurple
 *   WARNING  yellow/orange
 *   NEUTRAL  gray (default)
 */

export const COLORS = Object.freeze({
  SUCCESS: 0x57f287,
  ERROR: 0xed4245,
  INFO: 0x5865f2,
  WARNING: 0xfee75c,
  NEUTRAL: 0x99aab5,
});

const FOOTER = { text: `${APP_NAME} v${APP_VERSION}` };

function withBase(embed) {
  return embed.setFooter(FOOTER).setTimestamp(new Date());
}

/** Green embed. `fields` is an array of { name, value, inline? }. */
export function successEmbed({ title = 'Success', description = null, fields = [] } = {}) {
  const e = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(title);
  if (description) e.setDescription(description);
  if (fields.length) e.addFields(fields);
  return withBase(e);
}

/** Red embed for errors. */
export function errorEmbed({ title = 'Error', description = null, fields = [] } = {}) {
  const e = new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setTitle(title);
  if (description) e.setDescription(description);
  if (fields.length) e.addFields(fields);
  return withBase(e);
}

/** Blurple embed for informational output. */
export function infoEmbed({ title = null, description = null, fields = [] } = {}) {
  const e = new EmbedBuilder().setColor(COLORS.INFO);
  if (title) e.setTitle(title);
  if (description) e.setDescription(description);
  if (fields.length) e.addFields(fields);
  return withBase(e);
}

/** Yellow embed for warnings. */
export function warningEmbed({ title = 'Warning', description = null, fields = [] } = {}) {
  const e = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle(title);
  if (description) e.setDescription(description);
  if (fields.length) e.addFields(fields);
  return withBase(e);
}

/**
 * Pagination footer helper: "Page 3 of 7".
 * Returns a new embed (does not mutate).
 */
export function withPageFooter(embed, page, totalPages) {
  return EmbedBuilder.from(embed).setFooter({
    text: `${FOOTER.text} • Page ${page} of ${totalPages}`,
  });
}

/**
 * Truncate long strings for field values (Discord limit: 1024 chars).
 */
export function truncate(str, max = 1024) {
  if (!str) return '';
  const s = String(str);
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
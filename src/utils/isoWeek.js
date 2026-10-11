/**
 * ISO 8601 week utilities.
 *
 * A week is identified by "YYYY-Www" (e.g. "2026-W41"). Week 1 is the
 * week containing the first Thursday of the year. Week boundaries are
 * always Monday 00:00 UTC → the following Monday 00:00 UTC.
 *
 * All arithmetic is UTC. Display-timezone conversion is a rendering
 * concern and lives elsewhere.
 */

/**
 * Return the ISO year and week number for a given date.
 * Returns { year, week } where week is 1–53.
 */
export function isoWeekParts(date) {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
  // Shift to Thursday of the current week (ISO weeks are Thursday-anchored).
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return { year, week };
}

/**
 * Build the canonical period key for a date, e.g. "2026-W41".
 */
export function isoWeekKey(date) {
  const { year, week } = isoWeekParts(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Return the Monday 00:00:00 UTC that starts the ISO week containing `date`.
 */
export function startOfIsoWeek(date) {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dayNum - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Return { startAt, endAt } for the ISO week containing `date`.
 * endAt is exclusive (Monday 00:00 UTC of the following week).
 */
export function isoWeekBounds(date) {
  const startAt = startOfIsoWeek(date);
  const endAt = new Date(startAt.getTime() + 7 * 86_400_000);
  return { startAt, endAt };
}

/**
 * Return { startAt, endAt } for a given ISO week key like "2026-W41".
 * Throws on malformed keys or out-of-range week numbers.
 */
export function boundsFromKey(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(key));
  if (!m) throw new Error(`Invalid ISO week key: ${key}`);
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  if (week < 1 || week > 53) throw new Error(`Invalid ISO week number: ${week}`);

  // Find Jan 4 (always in week 1 by ISO definition), then walk to Monday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = startOfIsoWeek(jan4);
  const startAt = new Date(week1Monday.getTime() + (week - 1) * 7 * 86_400_000);
  const endAt = new Date(startAt.getTime() + 7 * 86_400_000);

  // Sanity: recompute the key from startAt and confirm it matches.
  const recomputed = isoWeekKey(startAt);
  if (recomputed !== key) {
    throw new Error(`Week key ${key} does not match computed ${recomputed}`);
  }
  return { startAt, endAt };
}

/**
 * Given a period key, return the previous period's key.
 */
export function previousKey(key) {
  const { startAt } = boundsFromKey(key);
  return isoWeekKey(new Date(startAt.getTime() - 86_400_000));
}

/**
 * Given a period key, return the next period's key.
 */
export function nextKey(key) {
  const { endAt } = boundsFromKey(key);
  return isoWeekKey(endAt);
}
/**
 * Formatting helpers for plain-text contexts.
 *
 * Discord does NOT render markdown (<@...>, <t:...>, `code`) inside:
 *   - StringSelectMenu option labels
 *   - StringSelectMenu option descriptions
 *   - Autocomplete choices
 *
 * Those contexts need pre-formatted plain text. These helpers produce it.
 *
 * Markdown IS rendered in embed fields, embed descriptions, messages,
 * and modal field values. Use Discord's own formatting there.
 */

/**
 * Format a Date (or ISO string or timestamp) as a short date string.
 * E.g. "10 Oct 2026"
 */
export function formatShortDate(dateOrString) {
  const d = toDate(dateOrString);
  if (!d) return 'unknown';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Format a Date as "10 Oct 2026 14:30 UTC"
 */
export function formatDateTime(dateOrString) {
  const d = toDate(dateOrString);
  if (!d) return 'unknown';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  }) + ' UTC';
}

/**
 * Format a date range as "10 Oct 2026 → 17 Oct 2026".
 * Compresses same-month/same-year ranges:
 *   "10 → 17 Oct 2026"
 */
export function formatDateRange(start, end) {
  const s = toDate(start);
  const e = toDate(end);
  if (!s || !e) return 'unknown period';

  const sd = s.getUTCDate();
  const ed = e.getUTCDate();
  const sm = s.getUTCMonth();
  const em = e.getUTCMonth();
  const sy = s.getUTCFullYear();
  const ey = e.getUTCFullYear();

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (sy === ey && sm === em) {
    return sd + ' → ' + ed + ' ' + monthNames[sm] + ' ' + sy;
  }
  if (sy === ey) {
    return sd + ' ' + monthNames[sm] + ' → ' + ed + ' ' + monthNames[em] + ' ' + sy;
  }
  return sd + ' ' + monthNames[sm] + ' ' + sy + ' → ' + ed + ' ' + monthNames[em] + ' ' + ey;
}

/**
 * Return a friendly relative time, e.g. "2 hours ago", "in 3 days".
 * For rendering inside plain-text option descriptions.
 */
export function formatRelative(dateOrString) {
  const d = toDate(dateOrString);
  if (!d) return 'unknown';
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  let unit;
  let value;
  if (abs < minute) {
    return 'just now';
  } else if (abs < hour) {
    value = Math.round(abs / minute);
    unit = 'minute';
  } else if (abs < day) {
    value = Math.round(abs / hour);
    unit = 'hour';
  } else if (abs < week) {
    value = Math.round(abs / day);
    unit = 'day';
  } else if (abs < 4 * week) {
    value = Math.round(abs / week);
    unit = 'week';
  } else {
    // Fall back to an absolute date
    return formatShortDate(d);
  }

  const plural = value === 1 ? '' : 's';
  return diffMs > 0
    ? 'in ' + value + ' ' + unit + plural
    : value + ' ' + unit + plural + ' ago';
}

/**
 * Truncate plain text for a select option (label max 100, description max 100).
 */
export function truncatePlain(text, max = 100) {
  if (!text) return '';
  const s = String(text).replace(/[\n\r]+/g, ' ');
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/**
 * Resolve a Discord user's display name via the client cache or fetch.
 * Returns the username or 'unknown user' if unavailable.
 *
 * Batched: pass an array of IDs, get a Map<id, username>.
 */
export async function resolveUsernames(client, discordIds) {
  const map = new Map();
  const unique = Array.from(new Set(discordIds.filter(Boolean)));

  // Try cache first.
  for (const id of unique) {
    const cached = client.users.cache.get(id);
    if (cached) map.set(id, cached.username);
  }

  // Fetch missing ones in parallel (bounded).
  const missing = unique.filter((id) => !map.has(id));
  const chunks = [];
  for (let i = 0; i < missing.length; i += 10) {
    chunks.push(missing.slice(i, i + 10));
  }

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map((id) =>
        client.users.fetch(id).then((u) => ({ id, username: u.username })).catch(() => ({ id, username: null }))
      )
    );
    for (const r of results) {
      if (r.username) map.set(r.id, r.username);
    }
  }

  return map;
}

// ============================================================
//  Internals
// ============================================================

function toDate(input) {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') return new Date(input);
  if (typeof input === 'string') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
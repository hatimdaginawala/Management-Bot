/**
 * Short-lived interaction session store.
 *
 * Multi-step flows (like /attendance add) need to carry state between
 * select menus and modals, which Discord doesn't support natively.
 *
 * In-memory only. Cleared on completion or after TTL. Loses state on
 * bot restart — acceptable, since the flows are seconds-long.
 */

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

const map = new Map(); // `${kind}:${discordId}` -> { data, expiresAt }

/**
 * Start a fresh session, overwriting any existing one of the same kind.
 */
export function startSession(kind, discordId, data = {}) {
  const key = kind + ':' + discordId;
  map.set(key, { data: { ...data }, expiresAt: Date.now() + SESSION_TTL_MS });
}

/**
 * Get the session data, or null if missing/expired.
 */
export function getSession(kind, discordId) {
  const key = kind + ':' + discordId;
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Merge new fields into an existing session. No-op if none exists.
 */
export function updateSession(kind, discordId, patch) {
  const key = kind + ':' + discordId;
  const entry = map.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    map.delete(key);
    return null;
  }
  entry.data = { ...entry.data, ...patch };
  return entry.data;
}

/**
 * Delete a session.
 */
export function clearSession(kind, discordId) {
  map.delete(kind + ':' + discordId);
}

/**
 * Periodic cleanup — called from a timer or lazily.
 * Also invoked at the start of every read to keep the map small.
 */
export function sweepExpired() {
  const now = Date.now();
  for (const [key, entry] of map.entries()) {
    if (entry.expiresAt < now) map.delete(key);
  }
}

export function addToSessionArray(kind, discordId, field, values) {
  const key = kind + ':' + discordId;
  const entry = map.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    map.delete(key);
    return null;
  }
  const existing = new Set(entry.data[field] || []);
  for (const v of values) existing.add(v);
  entry.data[field] = Array.from(existing);
  return entry.data;
}

export function removeFromSessionArray(kind, discordId, field, values) {
  const key = kind + ':' + discordId;
  const entry = map.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    map.delete(key);
    return null;
  }
  const removeSet = new Set(values);
  entry.data[field] = (entry.data[field] || []).filter((v) => !removeSet.has(v));
  return entry.data;
}
// Lazy sweep: run on every getSession call? That's expensive at scale.
// For our scale (< 50 concurrent sessions) it's fine to sweep every
// 60 seconds.
setInterval(sweepExpired, 60_000).unref?.();
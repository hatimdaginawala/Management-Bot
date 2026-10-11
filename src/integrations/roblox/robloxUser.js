import { robloxGet } from './httpClient.js';
import logger from '../../config/logger.js';

const BASE = 'https://users.roblox.com/v1';

/**
 * Look up a Roblox user by exact username.
 * Returns { id, name, displayName, description, created, ... } or null.
 *
 * Roblox's `username` search is exact-match on this endpoint.
 * For fuzzy matching we'd use `/v1/usernames/users` with a POST body,
 * but exact is what we want here — the user typed a username.
 */
export async function getUserByUsername(username) {
  const data = await robloxGet(`${BASE}/users/search?keyword=${encodeURIComponent(username)}&limit=10`);
  if (!data || data.__notFound) return null;

  // `users/search` returns paginated `{ data: [...] }`.
  const exact = (data.data ?? []).find(
    (u) => u.name.toLowerCase() === username.toLowerCase()
  );
  return exact ?? null;
}

/**
 * Fetch a Roblox user by numeric ID.
 */
export async function getUserById(robloxId) {
  const data = await robloxGet(`${BASE}/users/${robloxId}`);
  if (!data || data.__notFound) return null;
  return data;
}

/**
 * Fetch the full profile including the About field (`description`).
 * This is what verification reads.
 */
export async function getUserProfile(robloxId) {
  const data = await robloxGet(`${BASE}/users/${robloxId}`);
  if (!data || data.__notFound) return null;
  return {
    id: String(data.id),
    name: data.name,
    displayName: data.displayName,
    description: data.description ?? '',
    created: data.created,
    isBanned: data.isBanned ?? false,
  };
}

/**
 * Batch resolve usernames → user objects.
 * Roblox supports up to 100 per request.
 */
export async function getUsersByUsernames(usernames) {
  if (!usernames.length) return [];
  const chunks = [];
  for (let i = 0; i < usernames.length; i += 100) {
    chunks.push(usernames.slice(i, i + 100));
  }
  const out = [];
  for (const chunk of chunks) {
    const res = await robloxPost(`${BASE}/usernames/users`, {
      usernames: chunk,
      excludeBannedUsers: false,
    });
    out.push(...(res?.data ?? []));
  }
  return out;
}

/**
 * POST variant for the username batch endpoint.
 * Kept private to this module.
 */
async function robloxPost(url, body) {
  // We don't use the GET client here; write a minimal POST that mirrors
  // the retry policy.
  const { default: axios } = await import('axios');
  const client = axios.create({
    timeout: 10_000,
    headers: {
      'User-Agent': 'guard24-bot/1.0 (+https://github.com/24th-guard-rifles)',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    validateStatus: () => true,
  });
  const res = await client.post(url, body);
  if (res.status === 200) return res.data;
  if (res.status === 429) {
    const wait = parseInt(res.headers['retry-after'] ?? '2', 10) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return robloxPost(url, body);
  }
  logger.warn({ url, status: res.status }, 'Roblox POST failed');
  return null;
}
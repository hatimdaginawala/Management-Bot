import { robloxGet } from './httpClient.js';
import logger from '../../config/logger.js';

const BASE = 'https://users.roblox.com/v1';

/**
 * Look up a Roblox user by exact username.
 *
 * Prefers the /usernames/users POST endpoint, which is the dedicated
 * exact-match lookup and has higher rate limits than /users/search.
 * Falls back to search only if the primary returns no data.
 */
export async function getUserByUsername(username) {
  // Primary: exact-match POST endpoint.
  try {
    const exact = await robloxPost(`${BASE}/usernames/users`, {
      usernames: [username],
      excludeBannedUsers: false,
    });
    const match = (exact?.data ?? [])[0];
    if (match) {
      return {
        id: match.id,
        name: match.name,
        displayName: match.displayName,
        previousUsernames: match.previousUsernames ?? [],
        hasVerifiedBadge: match.hasVerifiedBadge ?? false,
        isBanned: false,
      };
    }
  } catch (err) {
    logger.debug(
      { username, err: err.message },
      'Exact-match lookup failed, falling back to search'
    );
  }

  // Fallback: search endpoint with strict exact filter.
  const data = await robloxGet(
    `${BASE}/users/search?keyword=${encodeURIComponent(username)}&limit=10`
  );
  if (!data || data.__notFound) return null;

  const exact = (data.data ?? []).find(
    (u) => u.name.toLowerCase() === username.toLowerCase()
  );
  return exact ?? null;
}

export async function getUserById(robloxId) {
  const data = await robloxGet(`${BASE}/users/${robloxId}`);
  if (!data || data.__notFound) return null;
  return data;
}

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
 * POST with retries on 429 and 5xx. Uses a browser-like User-Agent
 * because Roblox's CDN rejects some non-browser clients.
 */
async function robloxPost(url, body) {
  const { default: axios } = await import('axios');
  const client = axios.create({
    timeout: 10_000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; guard24-bot/1.0; +https://github.com/24th-guard-rifles)',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    validateStatus: () => true,
  });

  let lastErr = null;
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await client.post(url, body);

      if (res.status === 200) return res.data;

      if (res.status === 429) {
        // Honour Retry-After if present, else exponential backoff.
        const retryAfter = parseInt(res.headers['retry-after'] ?? '0', 10);
        const wait = retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt);
        logger.warn(
          { url, attempt, wait },
          'Roblox POST rate-limited, retrying'
        );
        await new Promise((r) => setTimeout(r, wait));
        lastErr = new Error('Rate limited');
        continue;
      }

      if (res.status >= 500 && attempt < maxRetries) {
        const wait = 1000 * Math.pow(2, attempt);
        logger.warn(
          { url, status: res.status, attempt, wait },
          'Roblox POST 5xx, retrying'
        );
        await new Promise((r) => setTimeout(r, wait));
        lastErr = new Error('Server error ' + res.status);
        continue;
      }

      logger.warn({ url, status: res.status }, 'Roblox POST failed');
      return null;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      break;
    }
  }

  throw lastErr ?? new Error('Roblox POST exhausted retries');
}
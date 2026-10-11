import axios from 'axios';
import logger from '../../config/logger.js';
import { ExternalAPIError } from '../../utils/errors.js';

/**
 * Shared Roblox HTTP client.
 *
 * Notes:
 *  - Roblox public APIs occasionally return 429 with a Retry-After header.
 *    We honour it up to `maxRetries`.
 *  - A default User-Agent is required by Roblox's edge (they reject
 *    missing UA on some endpoints).
 *  - We do NOT authenticate. Public endpoints only. If we ever add
 *    Open Cloud, this file gains a second client instance.
 */

const DEFAULT_HEADERS = {
  'User-Agent': 'guard24-bot/1.0 (+https://github.com/24th-guard-rifles)',
  Accept: 'application/json',
};

const client = axios.create({
  timeout: 10_000,
  headers: DEFAULT_HEADERS,
  // Roblox returns 4xx for "user not found"; we do NOT want axios to
  // throw on those — we want to inspect them. So we opt out of the
  // default validateStatus.
  validateStatus: () => true,
});

/**
 * GET with retries on 429 and 5xx.
 * Throws ExternalAPIError only if all retries fail or a non-retryable
 * error occurs (network timeout, 4xx other than 429).
 */
export async function robloxGet(url, { maxRetries = 3, retryDelayMs = 1000 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await client.get(url);

      if (res.status === 200) return res.data;

      if (res.status === 429) {
        const wait = parseInt(res.headers['retry-after'] ?? '2', 10) * 1000;
        logger.warn({ url, attempt, wait }, 'Roblox rate-limited, retrying');
        await new Promise((r) => setTimeout(r, wait));
        lastError = new ExternalAPIError('Roblox', `Rate limited (429)`);
        continue;
      }

      if (res.status >= 500 && attempt < maxRetries) {
        logger.warn({ url, status: res.status, attempt }, 'Roblox 5xx, retrying');
        await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
        lastError = new ExternalAPIError('Roblox', `Server error ${res.status}`);
        continue;
      }

      if (res.status === 404) {
        // Let the caller decide what 404 means; return a sentinel.
        return { __notFound: true, status: 404 };
      }

      // Any other status: treat as a non-retryable external error.
      throw new ExternalAPIError('Roblox', `Unexpected status ${res.status} for ${url}`, {
        status: res.status,
        body: res.data,
      });
    } catch (err) {
      if (err instanceof ExternalAPIError) throw err;
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
        continue;
      }
      throw new ExternalAPIError('Roblox', err.message, { code: err.code });
    }
  }

  throw lastError ?? new ExternalAPIError('Roblox', 'Unknown error');
}
import * as robloxUserIntegration from '../integrations/roblox/robloxUser.js';
import logger from '../config/logger.js';

/**
 * Service-level wrapper around the Roblox user integration.
 *
 * Responsibilities:
 *   - Add logging context (which caller asked).
 *   - Cache short-lived lookups? (Not in Phase 4 — Roblox's rate
 *     limits are generous for our scale, and correctness beats speed.)
 *   - Provide a stable interface so the integration can be swapped.
 */

export async function findUserByUsername(username) {
  const user = await robloxUserIntegration.getUserByUsername(username);
  if (user) {
    logger.debug({ username, robloxId: user.id }, 'Roblox user found');
  } else {
    logger.debug({ username }, 'Roblox user not found');
  }
  return user;
}

export async function findUserById(robloxId) {
  return robloxUserIntegration.getUserById(robloxId);
}

export async function getProfile(robloxId) {
  return robloxUserIntegration.getUserProfile(robloxId);
}

export async function findUsersByUsernames(usernames) {
  return robloxUserIntegration.getUsersByUsernames(usernames);
}
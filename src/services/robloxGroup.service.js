import * as robloxGroupIntegration from '../integrations/roblox/robloxGroup.js';
import logger from '../config/logger.js';

/**
 * Service-level wrapper around the Roblox group integration.
 * The sync service calls this, never the integration directly.
 */

export async function fetchGroupInfo(groupId) {
  const info = await robloxGroupIntegration.getGroupInfo(groupId);
  if (!info) logger.warn({ groupId }, 'Group info not found');
  return info;
}

export async function fetchGroupRoles(groupId) {
  return robloxGroupIntegration.getGroupRoles(groupId);
}

export async function fetchAllGroupMembers(groupId, opts = {}) {
  return robloxGroupIntegration.getAllGroupMembers(groupId, opts);
}
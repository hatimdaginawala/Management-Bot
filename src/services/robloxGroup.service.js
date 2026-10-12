import * as robloxGroupIntegration from '../integrations/roblox/robloxGroup.js';
import logger from '../config/logger.js';

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
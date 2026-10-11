import { robloxGet } from './httpClient.js';
import logger from '../../config/logger.js';

const GROUPS_BASE = 'https://groups.roblox.com/v1/groups';
const MAX_PAGE_SIZE = 100;
const MAX_PAGES = 500; // hard cap = 50,000 members; bump if the group grows

/**
 * Roblox group API integration.
 *
 * Public endpoints only. No auth. Callers must pass the group ID.
 */

/**
 * Fetch group metadata.
 * Returns { id, name, description, owner, memberCount, created, ... } or null.
 */
export async function getGroupInfo(groupId) {
  const data = await robloxGet(`${GROUPS_BASE}/${groupId}`);
  if (!data || data.__notFound) return null;
  return {
    id: String(data.id),
    name: data.name,
    description: data.description ?? '',
    owner: data.owner
      ? { userId: String(data.owner.userId), username: data.owner.username }
      : null,
    memberCount: data.memberCount ?? 0,
    created: data.created ?? null,
  };
}

/**
 * Fetch the role catalog for a group.
 * Returns an array sorted by rank DESC:
 *   [{ id, name, rank, memberCount }, ...]
 *
 * Roblox returns `rank` as an integer (0 = lowest tier, 255 = highest).
 * Role ID `0` is "Guest" (not a member). We keep it in the catalog so
 * rank lookups never fail.
 */
export async function getGroupRoles(groupId) {
  const data = await robloxGet(`${GROUPS_BASE}/${groupId}/roles`);
  if (!data || !Array.isArray(data.roles)) return [];
  return data.roles
    .map((r) => ({
      id: Number(r.id),
      name: r.name,
      rank: Number(r.rank),
      memberCount: r.memberCount ?? 0,
    }))
    .sort((a, b) => b.rank - a.rank);
}

/**
 * Fetch all group members, handling pagination.
 * Returns { members: [...], pages: N }.
 *
 * Each member: { userId, username, displayName, roleId, roleName, roleRank }
 *
 * Logs a warning and stops if MAX_PAGES is reached — this is a safety
 * valve against runaway loops; we'd rather complete with a truncated
 * list and let a follow-up sync pick up the rest.
 */
export async function getAllGroupMembers(groupId, { onProgress } = {}) {
  const members = [];
  let cursor = '';
  let pages = 0;

  while (pages < MAX_PAGES) {
    const url =
      `${GROUPS_BASE}/${groupId}/users?limit=${MAX_PAGE_SIZE}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');

    const data = await robloxGet(url);
    if (!data || data.__notFound) {
      logger.warn({ groupId, page: pages + 1 }, 'Group members endpoint returned 404');
      break;
    }

    const page = Array.isArray(data.data) ? data.data : [];
    for (const m of page) {
      members.push({
        userId: String(m.user?.userId ?? ''),
        username: m.user?.username ?? '',
        displayName: m.user?.displayName ?? m.user?.username ?? '',
        roleId: Number(m.role?.id ?? 0),
        roleName: m.role?.name ?? '',
        roleRank: Number(m.role?.rank ?? 0),
      });
    }

    pages++;
    if (typeof onProgress === 'function') {
      onProgress({ pages, fetched: members.length });
    }

    cursor = data.nextPageCursor ?? '';
    if (!cursor) break;
  }

  if (pages >= MAX_PAGES) {
    logger.warn({ groupId, pages, fetched: members.length }, 'Hit MAX_PAGES cap during member fetch');
  }

  return { members, pages };
}
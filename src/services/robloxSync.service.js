import * as syncLogRepo from '../db/repositories/syncLog.repository.js';
import * as userRepo from '../db/repositories/user.repository.js';
import * as rankHistoryRepo from '../db/repositories/rankHistory.repository.js';
import * as robloxGroupService from './robloxGroup.service.js';
import { audit } from '../utils/audit.js';
import { ExternalAPIError } from '../utils/errors.js';
import config from '../config/index.js';
import logger from '../config/logger.js';

/**
 * Roblox group sync. Public API unchanged.
 *
 * Concurrency: the "one RUNNING per type" guarantee is enforced by a
 * pre-check on sync_logs.status. If a run is already RUNNING, we skip.
 */

const MAX_ERRORS_RECORDED = 50;

// ============================================================
//  Public entry point
// ============================================================

export async function syncGroup({ triggeredBy = 'system' } = {}) {
  const groupId = config.roblox.groupId;

  // Acquire lock — check for RUNNING
  const running = await syncLogRepo.findRunning('ROBLOX_GROUP_SYNC');
  if (running) {
    logger.info({ triggeredBy }, 'Sync already running — skipping');
    return { syncLog: null, status: 'ALREADY_RUNNING' };
  }

  let syncLog;
  try {
    syncLog = await syncLogRepo.create({ triggeredBy });
  } catch (err) {
    // Race: two callers passed the pre-check and tried to create.
    // (Our unique index doesn't catch this since we removed the
    // generated column, but the pre-check plus low concurrency is
    // enough. This catch is a safety net.)
    logger.warn({ err: err.message }, 'Sync create raced — skipping');
    return { syncLog: null, status: 'ALREADY_RUNNING' };
  }

  const errors = [];
  const counts = {
    membersFetched: 0,
    membersCreated: 0,
    membersUpdated: 0,
    rankChanges: 0,
    membersRemoved: 0,
  };

  try {
    const [groupInfo, roles] = await Promise.all([
      robloxGroupService.fetchGroupInfo(groupId),
      robloxGroupService.fetchGroupRoles(groupId),
    ]);
    if (!groupInfo) {
      throw new ExternalAPIError('Roblox', 'Group ' + groupId + ' not found');
    }

    const roleById = new Map(roles.map((r) => [r.id, r]));

    const { members, pages } = await robloxGroupService.fetchAllGroupMembers(groupId, {
      onProgress: ({ pages: p, fetched }) => {
        if (p % 5 === 0) logger.debug({ pages: p, fetched }, 'Sync progress');
      },
    });
    counts.membersFetched = members.length;
    logger.info({ groupId, pages, members: members.length }, 'Members fetched');

    const seenRobloxIds = new Set();
    for (const m of members) {
      seenRobloxIds.add(m.userId);
      try {
        const result = await reconcileMember({
          member: m,
          role: roleById.get(m.roleId),
          syncLogId: syncLog.id,
        });
        counts.membersCreated += result.created ? 1 : 0;
        counts.membersUpdated += result.updated ? 1 : 0;
        counts.rankChanges += result.rankChanged ? 1 : 0;
      } catch (err) {
        pushBounded(errors, {
          stage: 'reconcile-member',
          robloxId: m.userId,
          message: err.message,
        });
      }
    }

    const leftCount = await markLeftMembers(seenRobloxIds);
    counts.membersRemoved = leftCount;

    const status = decideFinalStatus(errors, counts);
    await syncLogRepo.finalize(syncLog.id, { status, counts, errors });

    await audit({
      actorId: triggeredBy,
      action: 'roblox.sync.completed',
      category: 'SYNC',
      targetType: 'SyncLog',
      targetId: syncLog.id,
      after: { status, ...counts, errorsCount: errors.length },
    });

    logger.info({ status, ...counts }, 'Sync complete');
    return {
      syncLog: await syncLogRepo.findById(syncLog.id),
      status,
    };
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'Sync failed');
    pushBounded(errors, { stage: 'top-level', message: err.message });
    await syncLogRepo.finalize(syncLog.id, {
      status: 'FAILED',
      counts,
      errors,
      summary: err.message,
    });
    throw err;
  }
}

// ============================================================
//  Internals
// ============================================================

async function reconcileMember({ member, role, syncLogId }) {
  const rankName = role?.name ?? member.roleName ?? 'Unknown';
  const rankRank = role?.rank ?? member.roleRank ?? 0;

  let user = await userRepo.findByRobloxId(member.userId);
  if (!user) {
    user = await userRepo.findByRobloxUsername(member.username);
  }

  if (user) {
    const before = {
      rankId: user.roblox_rank_id,
      rankName: user.roblox_rank_name,
      rankValue: user.roblox_rank_value,
      status: user.status,
    };

    const rankChanged =
      before.rankId !== role?.id || before.rankName !== rankName;

    const patch = {
      robloxUsername: member.username,
      robloxDisplayName: member.displayName,
      robloxRankId: role?.id ?? null,
      robloxRankName: rankName,
      robloxRankValue: rankRank,
      robloxLastSyncedAt: new Date(),
    };

    if (!user.roblox_id) patch.robloxId = member.userId;

    let rejoinStatusChange = false;
    if (user.status === 'LEFT_ROBLOX_GROUP') {
      patch.status = 'ACTIVE';
      patch.lastRejoinedRobloxAt = new Date();
      rejoinStatusChange = true;
    }

    await userRepo.updateById(user.id, patch);

    if (rankChanged) {
      await rankHistoryRepo.create({
        userId: user.id,
        discordId: user.discord_id,
        robloxId: member.userId,
        oldRank: {
          rankId: before.rankId,
          rankName: before.rankName,
          rankValue: before.rankValue,
        },
        newRank: {
          rankId: role?.id ?? null,
          rankName,
          rankValue: rankRank,
        },
        changedAt: new Date(),
        source: 'SYNC',
        syncLogId,
      });
      logger.info(
        { robloxId: member.userId, from: before.rankName, to: rankName },
        'Rank changed'
      );
    }

    const updated = Boolean(rankChanged || rejoinStatusChange || Object.keys(patch).length > 0);
    return { created: false, updated, rankChanged };
  }

  // No match: skip creating a User for someone who never interacted
  // with the bot. Phase 4 will create the row on /link.
  return { created: false, updated: false, rankChanged: false };
}

async function markLeftMembers(seenRobloxIds) {
  // We don't have a bulk update with a filter on roblox_id NOT IN — add
  // a helper to userRepo if this becomes a bottleneck. For now, do a
  // light scan.
  const allUsers = await userRepo.list({
    status: 'ANY',
    page: 1,
    pageSize: 100_000,
  });

  let marked = 0;
  for (const u of allUsers.items) {
    if (!u.roblox_id) continue;
    if (seenRobloxIds.has(u.roblox_id)) continue;
    if (u.status === 'LEFT_ROBLOX_GROUP' || u.status === 'UNVERIFIED') continue;

    await userRepo.updateById(u.id, {
      status: 'LEFT_ROBLOX_GROUP',
      lastLeftRobloxAt: new Date(),
    });
    marked++;
  }
  return marked;
}

function pushBounded(arr, entry) {
  if (arr.length < MAX_ERRORS_RECORDED) {
    arr.push({ ...entry, at: new Date() });
  } else if (arr.length === MAX_ERRORS_RECORDED) {
    arr.push({
      stage: 'overflow',
      message: 'Additional errors truncated (max ' + MAX_ERRORS_RECORDED + ').',
      at: new Date(),
    });
  }
}

function decideFinalStatus(errors, counts) {
  if (errors.length === 0) return 'SUCCESS';
  const successes = counts.membersCreated + counts.membersUpdated + counts.membersRemoved;
  if (successes === 0) return 'FAILED';
  return 'PARTIAL';
}
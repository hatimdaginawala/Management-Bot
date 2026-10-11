import { SyncLog, User, RankHistory } from '../models/index.js';
import { audit } from '../utils/audit.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import * as robloxGroupService from './robloxGroup.service.js';
import { ExternalAPIError } from '../utils/errors.js';

const MAX_ERRORS_RECORDED = 50;

/**
 * Roblox group sync service.
 *
 * This is the ONLY entry point for Roblox synchronization. Both the
 * cron job (Phase 17) and the /sync roblox command (Phase 19) call
 * `syncGroup()`. Manual and scheduled syncs behave identically.
 *
 * ----------------------------------------------------------------------
 *  Data ownership (`.txt` §2, §8):
 *
 *  Roblox owns:                We own (and NEVER overwrite from sync):
 *  ------------------          ----------------------------------------
 *  user.robloxId               user.discordId
 *  user.robloxUsername         user.discordUsername
 *  user.roblox.username        user.status (except LEFT_ROBLOX_GROUP
 *  user.roblox.displayName      on "left group" and ACTIVE on rejoin)
 *  user.roblox.rankId          user.quota.*
 *  user.roblox.rankName        user.joinedAt
 *  user.roblox.rankValue       user.suspendedAt / suspensionReason
 *  user.roblox.lastSyncedAt    user.lastLeftRobloxAt
 *                              user.lastRejoinedRobloxAt
 *                              user.lastUnlinkedAt
 * ----------------------------------------------------------------------
 *
 * Concurrency: SyncLog has a partial unique index on (type, status=RUNNING).
 * A second `syncGroup()` while one is running will fail to create the
 * SyncLog document and return a "already running" status.
 */

// ============================================================
//  Public entry point
// ============================================================

/**
 * Run a Roblox group sync.
 *
 * @param {object} opts
 * @param {string} [opts.triggeredBy]  "system" or a discordId
 * @returns {Promise<{syncLog: object, status: string}>}
 */
export async function syncGroup({ triggeredBy = 'system' } = {}) {
  const groupId = config.roblox.groupId;

  // 1. Acquire the RUNNING lock.
  const syncLog = await acquireSyncLock(triggeredBy);
  if (!syncLog) {
    logger.info({ triggeredBy }, 'Sync already running — skipping');
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
    // 2. Fetch group metadata + role catalog.
    const [groupInfo, roles] = await Promise.all([
      robloxGroupService.fetchGroupInfo(groupId),
      robloxGroupService.fetchGroupRoles(groupId),
    ]);
    if (!groupInfo) {
      throw new ExternalAPIError('Roblox', `Group ${groupId} not found`);
    }

    const roleById = new Map(roles.map((r) => [r.id, r]));

    // 3. Fetch all members (paginated).
    const { members, pages } = await robloxGroupService.fetchAllGroupMembers(groupId, {
      onProgress: ({ pages: p, fetched }) => {
        if (p % 5 === 0) {
          logger.debug({ pages: p, fetched }, 'Sync progress');
        }
      },
    });
    counts.membersFetched = members.length;
    logger.info({ groupId, pages, members: members.length }, 'Members fetched');

    // 4. Reconcile.
    const seenRobloxIds = new Set();
    for (const m of members) {
      seenRobloxIds.add(m.userId);
      try {
        const result = await reconcileMember({
          member: m,
          role: roleById.get(m.roleId),
          syncLogId: syncLog._id,
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

    // 5. Detect members who left the Roblox group.
    //    Only consider users we previously saw in the group
    //    (i.e. have a robloxId and status not already LEFT).
    const leftCount = await markLeftMembers(seenRobloxIds);
    counts.membersRemoved = leftCount;

    // 6. Close the SyncLog.
    const status = decideFinalStatus(errors, counts);
    await finalizeSyncLog(syncLog._id, { status, counts, errors });

    await audit({
      actorId: triggeredBy,
      action: 'roblox.sync.completed',
      category: 'SYNC',
      targetType: 'SyncLog',
      targetId: syncLog._id,
      after: { status, ...counts, errorsCount: errors.length },
    });

    logger.info({ status, ...counts }, 'Sync complete');
    return {
      syncLog: await SyncLog.findById(syncLog._id).lean(),
      status,
    };
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'Sync failed');
    pushBounded(errors, { stage: 'top-level', message: err.message });
    await finalizeSyncLog(syncLog._id, {
      status: 'FAILED',
      counts,
      errors,
      summary: err.message,
    });
    throw err;
  }
}

// ============================================================
//  Internal steps
// ============================================================

/**
 * Acquire the sync lock atomically.
 *
 * Approach (no reliance on partial-unique index timing):
 *   1. Attempt to atomically flip an existing non-RUNNING sync to RUNNING.
 *   2. If none is available, insert a fresh RUNNING doc.
 *   3. If the insert fails with a duplicate-key error, return null (locked).
 *
 * The `uniq_running_per_type` partial-unique index still exists as a
 * second line of defense: it prevents two concurrent inserts from both
 * succeeding.
 *
 * A stale RUNNING doc (started > 30 min ago) is eligible for takeover.
 */
async function acquireSyncLock(triggeredBy) {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - 30 * 60 * 1000);

  // Fast path: is there a currently RUNNING (non-stale) sync?
  const running = await SyncLog.findOne({
    type: 'ROBLOX_GROUP_SYNC',
    status: 'RUNNING',
    startedAt: { $gte: staleThreshold },
  }).lean();
  if (running) return null;

  // Try to take over a stale RUNNING doc via CAS.
  const takenOver = await SyncLog.findOneAndUpdate(
    {
      type: 'ROBLOX_GROUP_SYNC',
      status: 'RUNNING',
      startedAt: { $lt: staleThreshold },
    },
    {
      $set: {
        triggeredBy,
        startedAt: now,
        completedAt: null,
        membersFetched: 0,
        membersCreated: 0,
        membersUpdated: 0,
        rankChanges: 0,
        membersRemoved: 0,
        capturedErrors: [],
        summary: 'Taken over from stale previous run.',
      },
    },
    { new: true }
  );
  if (takenOver) return takenOver;

  // Fresh insert. The partial-unique index catches the concurrent case.
  try {
    return await SyncLog.create({
      type: 'ROBLOX_GROUP_SYNC',
      triggeredBy,
      startedAt: now,
      status: 'RUNNING',
    });
  } catch (err) {
    if (err.code === 11000) return null;
    throw err;
  }
}

async function finalizeSyncLog(syncLogId, { status, counts, errors, summary = null }) {
  return SyncLog.updateOne(
    { _id: syncLogId },
    {
      $set: {
        status,
        completedAt: new Date(),
        membersFetched: counts.membersFetched,
        membersCreated: counts.membersCreated,
        membersUpdated: counts.membersUpdated,
        rankChanges: counts.rankChanges,
        membersRemoved: counts.membersRemoved,
        capturedErrors: errors.slice(0, MAX_ERRORS_RECORDED),
        summary,
      },
    }
  );
}

/**
 * Reconcile one Roblox member against our User collection.
 * Returns { created, updated, rankChanged }.
 *
 * Match strategy (in order):
 *   1. By robloxId  — the definitive link.
 *   2. By robloxUsername — fallback for users whose robloxId wasn't
 *      set (shouldn't happen given Phase 4, but self-healing is good).
 *   3. If no match, we DO NOT create a User. Rationale below.
 */
async function reconcileMember({ member, role, syncLogId }) {
  const rankName = role?.name ?? member.roleName ?? 'Unknown';
  const rankRank = role?.rank ?? member.roleRank ?? 0;

  let user = await User.findOne({ robloxId: member.userId });
  if (!user) {
    user = await User.findOne({ robloxUsername: member.username });
  }

  // ---- Existing user (matched) ----
  if (user) {
    const before = {
      rankId: user.roblox?.rankId ?? null,
      rankName: user.roblox?.rankName ?? null,
      rankValue: user.roblox?.rankValue ?? null,
      status: user.status,
    };

    const rankChanged = before.rankId !== role?.id || before.rankName !== rankName;

    // Only Roblox-owned fields are written here.
    user.roblox = {
      username: member.username,
      displayName: member.displayName,
      rankId: role?.id ?? null,
      rankName,
      rankValue: rankRank,
      lastSyncedAt: new Date(),
    };
    // Keep top-level aliases in sync (they're how other services query).
    user.robloxUsername = member.username;
    if (!user.robloxId) user.robloxId = member.userId;

    // Status handling — the ONLY application-owned field we touch,
    // and only for rejoin. We never demote ACTIVE→other states here.
    let rejoinStatusChange = false;
    if (user.status === 'LEFT_ROBLOX_GROUP') {
      user.status = 'ACTIVE';
      user.lastRejoinedRobloxAt = new Date();
      rejoinStatusChange = true;
    } else if (user.status === 'UNVERIFIED') {
      // User is in the group but never linked their Discord. We know the
      // Roblox identity but not the Discord identity. Leave UNVERIFIED
      // (Phase 4 or manual link completes the pairing).
      // Set robloxUsername so a future /link can pre-match by username.
    }

    const updated =
      rankChanged ||
      rejoinStatusChange ||
      before.rankName !== rankName ||
      user.isModified();

    if (user.isModified()) {
      await user.save();
    }

    if (rankChanged) {
      await RankHistory.create({
        user: user._id,
        discordId: user.discordId,
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
        syncLog: syncLogId,
      });
      logger.info(
        { robloxId: member.userId, from: before.rankName, to: rankName },
        'Rank changed'
      );
    }

    return { created: false, updated: Boolean(updated), rankChanged };
  }

  // ---- No match: skip creation ----
  //
  // Design decision: we do NOT create a User for every Roblox group
  // member. A User row represents "someone the bot knows about" and is
  // anchored on a discordId (required field). Members who never
  // interacted with Discord have no discordId.
  //
  // When such a member later runs /link, Phase 4 will:
  //   - find the Roblox account
  //   - match by robloxUsername (this user is already in the group)
  //   - create the User row and link both identities atomically.
  //
  // This keeps our `users` collection clean and correct.
  return { created: false, updated: false, rankChanged: false };
}

/**
 * For any User with a robloxId NOT in `seenRobloxIds` and status
 * not already LEFT_ROBLOX_GROUP/UNVERIFIED, mark them as having left.
 * Never deletes, never touches other fields.
 */
async function markLeftMembers(seenRobloxIds) {
  const result = await User.updateMany(
    {
      robloxId: { $nin: Array.from(seenRobloxIds), $exists: true, $ne: null },
      status: { $nin: ['LEFT_ROBLOX_GROUP', 'UNVERIFIED'] },
    },
    {
      $set: {
        status: 'LEFT_ROBLOX_GROUP',
        lastLeftRobloxAt: new Date(),
      },
    }
  );
  return result.modifiedCount ?? 0;
}

function pushBounded(arr, entry) {
  if (arr.length < MAX_ERRORS_RECORDED) {
    arr.push({ ...entry, at: new Date() });
  } else if (arr.length === MAX_ERRORS_RECORDED) {
    arr.push({
      stage: 'overflow',
      message: `Additional errors truncated (max ${MAX_ERRORS_RECORDED}).`,
      at: new Date(),
    });
  }
}

/**
 * Decide the final SyncLog status.
 *   SUCCESS  = no errors
 *   PARTIAL  = some errors, some progress
 *   FAILED   = no members fetched at all OR more errors than successes
 */
function decideFinalStatus(errors, counts) {
  if (errors.length === 0) return 'SUCCESS';
  const successes = counts.membersCreated + counts.membersUpdated + counts.membersRemoved;
  if (successes === 0) return 'FAILED';
  return 'PARTIAL';
}
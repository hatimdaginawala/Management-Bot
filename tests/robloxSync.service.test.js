import { describe, test, expect, beforeEach, beforeAll, jest } from '@jest/globals';
import { User, RankHistory, SyncLog } from '../src/models/index.js';

// --- Mock the group integration BEFORE importing the sync service ---
const mockGroup = {
  fetchGroupInfo: jest.fn(),
  fetchGroupRoles: jest.fn(),
  fetchAllGroupMembers: jest.fn(),
};

jest.unstable_mockModule('../src/services/robloxGroup.service.js', () => mockGroup);

let syncService;

beforeAll(async () => {
  syncService = await import('../src/services/robloxSync.service.js');
});

// --- Fixtures ---
const GROUP_INFO = {
  id: '10410582',
  name: '24th Guard Rifles',
  memberCount: 3,
};

const ROLES = [
  { id: 1, name: 'Low Rank', rank: 1, memberCount: 2 },
  { id: 2, name: 'Staff',    rank: 10, memberCount: 1 },
];

function member(userId, username, roleId) {
  const role = ROLES.find((r) => r.id === roleId);
  return {
    userId: String(userId),
    username,
    displayName: username,
    roleId,
    roleName: role?.name ?? '',
    roleRank: role?.rank ?? 0,
  };
}

beforeEach(async () => {
  mockGroup.fetchGroupInfo.mockReset();
  mockGroup.fetchGroupRoles.mockReset();
  mockGroup.fetchAllGroupMembers.mockReset();
});

// ===========================================================================
describe('robloxSync.service — syncGroup', () => {
  test('SUCCESS with no changes on empty group', async () => {
    mockGroup.fetchGroupInfo.mockResolvedValue(GROUP_INFO);
    mockGroup.fetchGroupRoles.mockResolvedValue(ROLES);
    mockGroup.fetchAllGroupMembers.mockResolvedValue({ members: [], pages: 1 });

    const { status, syncLog } = await syncService.syncGroup();
    expect(status).toBe('SUCCESS');
    expect(syncLog.membersFetched).toBe(0);
  });

  test('updates an existing user rank and creates RankHistory', async () => {
    const user = await User.create({
      discordId: 'd1',
      robloxId: '1001',
      robloxUsername: 'Alpha',
      status: 'ACTIVE',
      roblox: { rankId: 1, rankName: 'Low Rank', rankValue: 1 },
    });

    mockGroup.fetchGroupInfo.mockResolvedValue(GROUP_INFO);
    mockGroup.fetchGroupRoles.mockResolvedValue(ROLES);
    mockGroup.fetchAllGroupMembers.mockResolvedValue({
      members: [member(1001, 'Alpha', 2)], // promoted to Staff
      pages: 1,
    });

    const { status, syncLog } = await syncService.syncGroup();
    expect(status).toBe('SUCCESS');
    expect(syncLog.rankChanges).toBe(1);
    expect(syncLog.membersUpdated).toBe(1);

    const reloaded = await User.findById(user._id);
    expect(reloaded.roblox.rankId).toBe(2);
    expect(reloaded.roblox.rankName).toBe('Staff');

    const history = await RankHistory.find({ user: user._id });
    expect(history).toHaveLength(1);
    expect(history[0].oldRank.rankName).toBe('Low Rank');
    expect(history[0].newRank.rankName).toBe('Staff');
  });

  test('does NOT touch application-owned fields', async () => {
    const user = await User.create({
      discordId: 'd2',
      robloxId: '1002',
      robloxUsername: 'Bravo',
      status: 'ACTIVE',
      quota: { exempt: true, exemptUntil: null, exemptReason: 'test', category: 'STAFF' },
      roblox: { rankId: 1, rankName: 'Low Rank', rankValue: 1 },
    });

    mockGroup.fetchGroupInfo.mockResolvedValue(GROUP_INFO);
    mockGroup.fetchGroupRoles.mockResolvedValue(ROLES);
    mockGroup.fetchAllGroupMembers.mockResolvedValue({
      members: [member(1002, 'Bravo', 2)],
      pages: 1,
    });

    await syncService.syncGroup();

    const reloaded = await User.findById(user._id);
    expect(reloaded.quota.exempt).toBe(true);
    expect(reloaded.quota.exemptReason).toBe('test');
    expect(reloaded.quota.category).toBe('STAFF');
  });

  test('marks members who left the group', async () => {
    const user = await User.create({
      discordId: 'd3',
      robloxId: '1003',
      robloxUsername: 'Charlie',
      status: 'ACTIVE',
      roblox: { rankId: 1, rankName: 'Low Rank', rankValue: 1 },
    });

    mockGroup.fetchGroupInfo.mockResolvedValue(GROUP_INFO);
    mockGroup.fetchGroupRoles.mockResolvedValue(ROLES);
    mockGroup.fetchAllGroupMembers.mockResolvedValue({
      members: [], // Charlie is gone
      pages: 1,
    });

    const { syncLog } = await syncService.syncGroup();
    expect(syncLog.membersRemoved).toBe(1);

    const reloaded = await User.findById(user._id);
    expect(reloaded.status).toBe('LEFT_ROBLOX_GROUP');
    expect(reloaded.lastLeftRobloxAt).toBeInstanceOf(Date);
  });

  test('rejoin flips status back to ACTIVE', async () => {
    const user = await User.create({
      discordId: 'd4',
      robloxId: '1004',
      robloxUsername: 'Delta',
      status: 'LEFT_ROBLOX_GROUP',
      roblox: { rankId: 1, rankName: 'Low Rank', rankValue: 1 },
    });

    mockGroup.fetchGroupInfo.mockResolvedValue(GROUP_INFO);
    mockGroup.fetchGroupRoles.mockResolvedValue(ROLES);
    mockGroup.fetchAllGroupMembers.mockResolvedValue({
      members: [member(1004, 'Delta', 1)],
      pages: 1,
    });

    await syncService.syncGroup();

    const reloaded = await User.findById(user._id);
    expect(reloaded.status).toBe('ACTIVE');
    expect(reloaded.lastRejoinedRobloxAt).toBeInstanceOf(Date);
  });

  test('does NOT create User records for unlinked Roblox members', async () => {
    mockGroup.fetchGroupInfo.mockResolvedValue(GROUP_INFO);
    mockGroup.fetchGroupRoles.mockResolvedValue(ROLES);
    mockGroup.fetchAllGroupMembers.mockResolvedValue({
      members: [member(9999, 'Ghost', 1)],
      pages: 1,
    });

    await syncService.syncGroup();

    const ghost = await User.findOne({ robloxId: '9999' });
    expect(ghost).toBeNull();
  });

  test('prevents concurrent syncs via RUNNING lock', async () => {
    mockGroup.fetchGroupInfo.mockImplementation(
      () => new Promise((r) => setTimeout(() => r(GROUP_INFO), 100))
    );
    mockGroup.fetchGroupRoles.mockResolvedValue(ROLES);
    mockGroup.fetchAllGroupMembers.mockResolvedValue({ members: [], pages: 1 });

    const first = syncService.syncGroup();
    // Let the first sync acquire its lock.
    await new Promise((r) => setTimeout(r, 10));
    const second = await syncService.syncGroup();
    expect(second.status).toBe('ALREADY_RUNNING');

    await first;
    const runningCount = await SyncLog.countDocuments({ status: 'RUNNING' });
    expect(runningCount).toBe(0);
  });

  test('FAILED when top-level fetch throws', async () => {
    mockGroup.fetchGroupInfo.mockResolvedValue(null); // group not found
    mockGroup.fetchGroupRoles.mockResolvedValue([]);
    mockGroup.fetchAllGroupMembers.mockResolvedValue({ members: [], pages: 0 });

    await expect(syncService.syncGroup()).rejects.toThrow();

    const latest = await SyncLog.findOne().sort({ startedAt: -1 });
    expect(latest.status).toBe('FAILED');
  });
});
import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  listMembers,
  getMemberProfile,
  getMemberHistory,
  deactivateUser,
  reactivateUser,
  setQuotaExemption,
  clearQuotaExemption,
} from '../src/services/user.service.js';
import { assignRole } from '../src/services/role.service.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { User, Role, RoleAssignment, Strike, Leave, RankHistory } from '../src/models/index.js';
import { ValidationError, NotFoundError } from '../src/utils/errors.js';

async function makeAdmin(roleKey, discordId) {
  const user = await User.create({ discordId, status: 'ACTIVE' });
  const role = await Role.findOne({ key: roleKey });
  await RoleAssignment.create({
    user: user._id,
    discordId,
    role: role._id,
    roleKey: role.key,
    assignedBy: 'test',
    active: true,
  });
  return user;
}

async function makeMember(discordId, opts = {}) {
  return User.create({
    discordId,
    discordUsername: opts.discordUsername ?? discordId,
    robloxId: opts.robloxId,
    robloxUsername: opts.robloxUsername,
    status: opts.status ?? 'ACTIVE',
    quota: { exempt: false, exemptUntil: null, exemptReason: null, category: opts.quotaCategory ?? 'NONE' },
    roblox: opts.roblox ?? {},
  });
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
});

describe('user.service — listMembers', () => {
  test('default filters to ACTIVE', async () => {
    await makeMember('a1', { status: 'ACTIVE' });
    await makeMember('a2', { status: 'UNVERIFIED' });
    await makeMember('a3', { status: 'LEFT_ROBLOX_GROUP' });

    const result = await listMembers();
    expect(result.total).toBe(1);
    expect(result.items[0].discordId).toBe('a1');
  });

  test('status: ANY returns all', async () => {
    await makeMember('b1', { status: 'ACTIVE' });
    await makeMember('b2', { status: 'UNVERIFIED' });
    const result = await listMembers({ status: 'ANY' });
    expect(result.total).toBe(2);
  });

  test('filter by quotaCategory', async () => {
    await makeMember('c1', { quotaCategory: 'STAFF' });
    await makeMember('c2', { quotaCategory: 'LOW_RANK' });
    const result = await listMembers({ quotaCategory: 'STAFF' });
    expect(result.total).toBe(1);
    expect(result.items[0].discordId).toBe('c1');
  });

  test('search matches discordUsername and robloxUsername', async () => {
    await makeMember('d1', { discordUsername: 'AlphaWolf' });
    await makeMember('d2', { discordUsername: 'BravoBull', robloxUsername: 'AlphaSnake' });
    await makeMember('d3', { discordUsername: 'Charlie' });

    const result = await listMembers({ search: 'alpha' });
    expect(result.total).toBe(2);
  });

  test('pagination is correct', async () => {
    for (let i = 0; i < 30; i++) await makeMember(`p${i}`);
    const page1 = await listMembers({ page: 1, pageSize: 10 });
    const page3 = await listMembers({ page: 3, pageSize: 10 });
    expect(page1.total).toBe(30);
    expect(page1.items).toHaveLength(10);
    expect(page3.items).toHaveLength(10);
    expect(page1.items[0].discordId).not.toBe(page3.items[0].discordId);
    expect(page1.totalPages).toBe(3);
  });

  test('hasStrikes: true returns only users with ACTIVE strikes', async () => {
    const u1 = await makeMember('s1');
    const u2 = await makeMember('s2');
    await Strike.create({
      user: u1._id, discordId: 's1', type: 'QUOTA_MISSED',
      quotaPeriodKey: '2026-W40', reason: 'missed', issuedBy: 'system',
      status: 'ACTIVE',
    });
    const result = await listMembers({ hasStrikes: true });
    expect(result.total).toBe(1);
    expect(result.items[0].discordId).toBe('s1');
  });

  test('onLeave: true returns only users with active leave', async () => {
    const u1 = await makeMember('l1');
    await makeMember('l2');
    await Leave.create({
      user: u1._id, discordId: 'l1',
      startAt: new Date(Date.now() - 86_400_000),
      endAt: new Date(Date.now() + 86_400_000),
      reason: 'vacation', status: 'APPROVED',
    });
    const result = await listMembers({ onLeave: true });
    expect(result.total).toBe(1);
    expect(result.items[0].discordId).toBe('l1');
  });
});

describe('user.service — getMemberProfile', () => {
  test('returns null for unknown user', async () => {
    expect(await getMemberProfile('nobody')).toBeNull();
  });

  test('returns full profile with roles and strikes', async () => {
    const admin = await makeAdmin('super_admin', 'admin-1');
    const user = await makeMember('prof1');
    await assignRole(admin.discordId, 'prof1', 'staff');
    await Strike.create({
      user: user._id, discordId: 'prof1', type: 'QUOTA_MISSED',
      quotaPeriodKey: '2026-W40', reason: 'missed', issuedBy: 'system',
      status: 'ACTIVE',
    });

    const profile = await getMemberProfile('prof1');
    expect(profile.user.discordId).toBe('prof1');
    expect(profile.roles.map((r) => r.key)).toContain('staff');
    expect(profile.activeStrikes).toBe(1);
  });
});

describe('user.service — getMemberHistory', () => {
  test('merges rank, attendance, and strikes sorted DESC', async () => {
    const user = await makeMember('hist1', { robloxId: '999' });
    await RankHistory.create({
      user: user._id, discordId: 'hist1', robloxId: '999',
      oldRank: { rankId: 1, rankName: 'Low Rank' },
      newRank: { rankId: 2, rankName: 'Staff' },
      changedAt: new Date(Date.now() - 1000),
      source: 'SYNC',
    });
    await Strike.create({
      user: user._id, discordId: 'hist1', type: 'QUOTA_MISSED',
      quotaPeriodKey: '2026-W40', reason: 'missed', issuedBy: 'system',
      status: 'ACTIVE',
    });
    const history = await getMemberHistory('hist1');
    expect(history.events.length).toBeGreaterThanOrEqual(2);
  });
});

describe('user.service — deactivate/reactivate', () => {
  test('deactivate requires a reason', async () => {
    await makeMember('da1');
    await expect(deactivateUser('admin', 'da1', { reason: '' })).rejects.toThrow(ValidationError);
  });

  test('deactivate sets INACTIVE', async () => {
    await makeMember('da2');
    const user = await deactivateUser('admin', 'da2', { reason: 'disciplinary' });
    expect(user.status).toBe('INACTIVE');
  });

  test('reactivate flips back to ACTIVE', async () => {
    await makeMember('ra1', { status: 'INACTIVE' });
    const user = await reactivateUser('admin', 'ra1', { reason: 'appeal approved' });
    expect(user.status).toBe('ACTIVE');
  });

  test('reactivate on ACTIVE user is a no-op', async () => {
    await makeMember('ra2');
    const user = await reactivateUser('admin', 'ra2');
    expect(user.status).toBe('ACTIVE');
  });
});

describe('user.service — quota exemption', () => {
  test('setQuotaExemption requires a reason', async () => {
    await makeMember('q1');
    await expect(setQuotaExemption('admin', 'q1', { reason: '' })).rejects.toThrow(ValidationError);
  });

  test('setQuotaExemption with future exemptUntil', async () => {
    await makeMember('q2');
    const until = new Date(Date.now() + 86_400_000);
    const user = await setQuotaExemption('admin', 'q2', { reason: 'sick', exemptUntil: until });
    expect(user.quota.exempt).toBe(true);
    expect(user.quota.exemptReason).toBe('sick');
    expect(user.quota.exemptUntil.getTime()).toBe(until.getTime());
  });

  test('setQuotaExemption rejects past exemptUntil', async () => {
    await makeMember('q3');
    await expect(
      setQuotaExemption('admin', 'q3', { reason: 'x', exemptUntil: new Date(Date.now() - 1000) })
    ).rejects.toThrow(ValidationError);
  });

  test('clearQuotaExemption resets fields', async () => {
    await makeMember('q4');
    await setQuotaExemption('admin', 'q4', { reason: 'sick' });
    const user = await clearQuotaExemption('admin', 'q4', { reason: 'recovered' });
    expect(user.quota.exempt).toBe(false);
    expect(user.quota.exemptReason).toBeNull();
  });

  test('clearQuotaExemption is idempotent', async () => {
    await makeMember('q5');
    const user = await clearQuotaExemption('admin', 'q5');
    expect(user.quota.exempt).toBe(false);
  });
});
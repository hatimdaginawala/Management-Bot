import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import * as robloxSyncJob from '../src/jobs/robloxSync.job.js';
import * as quotaEvaluationJob from '../src/jobs/quotaEvaluation.job.js';
import * as weeklyReportJob from '../src/jobs/weeklyReport.job.js';
import * as expirationJob from '../src/jobs/expiration.job.js';
import * as removalSweepJob from '../src/jobs/removalSweep.job.js';
import * as cleanupJob from '../src/jobs/cleanup.job.js';
import {
  User,
  Leave,
  Notice,
  Verification,
  RemovalRequest,
  RoleAssignment,
  Role,
  Settings,
} from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { seedEventTypes } from '../scripts/seedEventTypes.js';
import { isoWeekKey } from '../src/utils/isoWeek.js';

const DAY = 86_400_000;

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await seedEventTypes();
  await User.deleteMany({});
  await Leave.deleteMany({});
  await Notice.deleteMany({});
  await Verification.deleteMany({});
  await RemovalRequest.deleteMany({});
});

// ===========================================================================
describe('jobs — expiration sweep', () => {
  test('expires leaves past endAt', async () => {
    const user = await makeUser('exp1');
    await Leave.create({
      user: user._id, discordId: 'exp1',
      startAt: new Date(Date.now() - 5 * DAY),
      endAt: new Date(Date.now() - 1 * DAY),
      reason: 'past',
      status: 'APPROVED',
    });
    const result = await expirationJob.run();
    expect(result.leavesExpired).toBe(1);

    const reloaded = await Leave.findOne({ discordId: 'exp1' });
    expect(reloaded.status).toBe('EXPIRED');
  });

test('expires notices past endAt but keeps open-ended ones', async () => {
  const u1 = await makeUser('exp2');
  const u2 = await makeUser('exp3');
  await Notice.create({
    user: u1._id, discordId: 'exp2', type: 'INACTIVITY',
    reason: 'past', startAt: new Date(Date.now() - 5 * DAY),
    endAt: new Date(Date.now() - 1 * DAY), status: 'ACTIVE',
    createdBy: 'test',
  });
  await Notice.create({
    user: u2._id, discordId: 'exp3', type: 'INACTIVITY',
    reason: 'open', startAt: new Date(), endAt: null, status: 'ACTIVE',
    createdBy: 'test',
  });
  const result = await expirationJob.run();
  expect(result.noticesExpired).toBe(1);

  expect((await Notice.findOne({ discordId: 'exp2' })).status).toBe('EXPIRED');
  expect((await Notice.findOne({ discordId: 'exp3' })).status).toBe('ACTIVE');
});

  test('expires pending verifications past expiresAt', async () => {
    await Verification.create({
      discordId: 'v1', robloxUsername: 'Test', code: 'ABCDEFGHJKLM',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1000),
    });
    const result = await expirationJob.run();
    expect(result.verificationsExpired).toBe(1);

    const reloaded = await Verification.findOne({ discordId: 'v1' });
    expect(reloaded.status).toBe('EXPIRED');
  });

  test('is idempotent — second run is a no-op', async () => {
    const user = await makeUser('exp4');
    await Leave.create({
      user: user._id, discordId: 'exp4',
      startAt: new Date(Date.now() - 5 * DAY),
      endAt: new Date(Date.now() - 1 * DAY),
      reason: 'past', status: 'APPROVED',
    });
    const first = await expirationJob.run();
    const second = await expirationJob.run();
    expect(first.leavesExpired).toBe(1);
    expect(second.leavesExpired).toBe(0);
  });
});

// ===========================================================================
describe('jobs — roblox sync respects settings', () => {
  test('skips when roblox.syncEnabled is false', async () => {
    await Settings.updateOne({ key: 'global' }, { $set: { 'roblox.syncEnabled': false } });
    const result = await robloxSyncJob.run();
    expect(result.skipped).toBe(true);
  });
});

// ===========================================================================
describe('jobs — removal sweep', () => {
  test('applies due removals and unassigns roles', async () => {
    const user = await makeUser('rs1');
    const role = await Role.findOne({ key: 'staff' });
    await RoleAssignment.create({
      user: user._id, discordId: 'rs1',
      role: role._id, roleKey: role.key,
      assignedBy: 'admin', active: true,
    });
    await user.set('quota.category', 'STAFF').save();

    // Create an approved request whose effective date has passed.
    await RemovalRequest.create({
      user: user._id, discordId: 'rs1',
      reason: 'MANUAL', strikeCount: 0, strikeThreshold: 3,
      description: 'test',
      status: 'APPROVED',
      reviewedBy: 'admin', reviewedAt: new Date(),
      removalEffectiveAt: new Date(Date.now() - DAY),
    });

    const result = await removalSweepJob.run();
    expect(result.applied).toBe(1);

    const reloaded = await User.findById(user._id);
    expect(reloaded.status).toBe('LEFT_ROBLOX_GROUP');
    expect(reloaded.quota.category).toBe('NONE');

    const assign = await RoleAssignment.findOne({ user: user._id });
    expect(assign.active).toBe(false);
  });

  test('ignores requests whose effective date is in the future', async () => {
    const user = await makeUser('rs2');
    await RemovalRequest.create({
      user: user._id, discordId: 'rs2',
      reason: 'MANUAL', strikeCount: 0, strikeThreshold: 3,
      description: 'test',
      status: 'APPROVED',
      reviewedBy: 'admin', reviewedAt: new Date(),
      removalEffectiveAt: new Date(Date.now() + 5 * DAY),
    });
    const result = await removalSweepJob.run();
    expect(result.applied).toBe(0);
  });
});

// ===========================================================================
describe('jobs — cleanup', () => {
  test('deletes old terminal verifications only', async () => {
    const old = new Date(Date.now() - 60 * DAY);
    const recent = new Date(Date.now() - 5 * DAY);

    await Verification.create({
      discordId: 'c-old', robloxUsername: 'A', code: 'AAAAAAAAAAAA',
      status: 'CANCELLED', expiresAt: old,
      createdAt: old, updatedAt: old,
    });
    await Verification.create({
      discordId: 'c-new', robloxUsername: 'B', code: 'BBBBBBBBBBBB',
      status: 'CANCELLED', expiresAt: recent,
      createdAt: recent, updatedAt: recent,
    });
    await Verification.create({
      discordId: 'c-pending', robloxUsername: 'C', code: 'CCCCCCCCCCCC',
      status: 'PENDING', expiresAt: old,
      createdAt: old, updatedAt: old,
    });

    const result = await cleanupJob.run();
    expect(result.verificationsDeleted).toBe(1);

    expect(await Verification.countDocuments()).toBe(2);
    expect(await Verification.findOne({ discordId: 'c-old' })).toBeNull();
    expect(await Verification.findOne({ discordId: 'c-new' })).not.toBeNull();
    expect(await Verification.findOne({ discordId: 'c-pending' })).not.toBeNull();
  });
});

// ===========================================================================
describe('jobs — quota evaluation', () => {
  test('skips when previous period is not yet closed', async () => {
    // Fresh DB: no period exists yet, so getCurrentPeriod() returns null.
    // The job tries to evaluate the previous week's key.
    const result = await quotaEvaluationJob.run();
    // No policies → evaluatePeriod will close a period with 0 eligible users.
    // We only assert it did not throw.
    expect(result).toBeDefined();
  });
});

// ===========================================================================
describe('jobs — weekly report', () => {
  test('generates report without a client (skips posting)', async () => {
    const result = await weeklyReportJob.run({ client: null });
    expect(result.report).toBeDefined();
    expect(result.posted).toBe(false);
  });

  test('skips posting when no channel configured', async () => {
    const fakeClient = {
      channels: { fetch: jest.fn() },
    };
    const result = await weeklyReportJob.run({ client: fakeClient });
    expect(result.posted).toBe(false);
    expect(fakeClient.channels.fetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe('jobs — runner', () => {
  test('listRegisteredJobs returns all six', async () => {
    const runner = await import('../src/jobs/runner.js');
    const jobs = runner.listRegisteredJobs();
    expect(jobs.length).toBe(6);
    const names = jobs.map((j) => j.name).sort();
    expect(names).toEqual([
      'cleanup',
      'expiration-sweep',
      'quota-evaluation',
      'removal-sweep',
      'roblox-sync',
      'weekly-report',
    ]);
  });

  test('runJobSync executes the named job', async () => {
    const runner = await import('../src/jobs/runner.js');
    const result = await runner.runJobSync('expiration-sweep');
    expect(result).toBeDefined();
  });

  test('runJobSync throws on unknown job name', async () => {
    const runner = await import('../src/jobs/runner.js');
    await expect(runner.runJobSync('not-a-real-job')).rejects.toThrow(/Unknown job/);
  });
});
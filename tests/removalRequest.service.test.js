import { describe, test, expect, beforeEach } from '@jest/globals';
import * as removalRequestService from '../src/services/removalRequest.service.js';
import * as strikeService from '../src/services/strike.service.js';
import { User, Strike, RemovalRequest, RoleAssignment, Role, Settings } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { ValidationError, ConflictError, NotFoundError } from '../src/utils/errors.js';

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await Strike.deleteMany({});
  await RemovalRequest.deleteMany({});
  await RoleAssignment.deleteMany({});
});

// ===========================================================================
describe('removalRequest.service — createManual', () => {
  test('creates a PENDING manual request', async () => {
    await makeUser('cm1');
    const req = await removalRequestService.createManual('admin', {
      targetDiscordId: 'cm1',
      description: 'Repeated inactivity beyond acceptable limits.',
    });
    expect(req.status).toBe('PENDING');
    expect(req.reason).toBe('MANUAL');
  });

  test('duplicate pending throws ConflictError', async () => {
    await makeUser('cm2');
    await removalRequestService.createManual('admin', {
      targetDiscordId: 'cm2',
      description: 'First request.',
    });
    await expect(
      removalRequestService.createManual('admin', {
        targetDiscordId: 'cm2',
        description: 'Second request.',
      })
    ).rejects.toThrow(ConflictError);
  });

  test('requires description', async () => {
    await makeUser('cm3');
    await expect(
      removalRequestService.createManual('admin', {
        targetDiscordId: 'cm3',
        description: '',
      })
    ).rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
describe('removalRequest.service — approveRemoval', () => {
  test('approves with default effectiveAt ≥ 3 days ahead', async () => {
    const user = await makeUser('ap1');
    const req = await removalRequestService.createManual('admin', {
      targetDiscordId: 'ap1',
      description: 'test',
    });

    const approved = await removalRequestService.approveRemoval('admin', req._id, {
      reason: 'confirmed',
    });
    expect(approved.status).toBe('APPROVED');
    expect(approved.removalEffectiveAt).toBeInstanceOf(Date);
    const deltaMs = approved.removalEffectiveAt.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThanOrEqual(3 * 86_400_000 - 1000); // ~3 days

    const reloaded = await User.findById(user._id);
    expect(reloaded.status).toBe('SUSPENDED');
    expect(reloaded.suspensionReason).toContain('Removal approved');
  });

  test('rejects effectiveAt less than 3 days ahead', async () => {
    await makeUser('ap2');
    const req = await removalRequestService.createManual('admin', {
      targetDiscordId: 'ap2',
      description: 'test',
    });
    const tooSoon = new Date(Date.now() + 86_400_000); // 1 day
    await expect(
      removalRequestService.approveRemoval('admin', req._id, { effectiveAt: tooSoon })
    ).rejects.toThrow(ValidationError);
  });

  test('rejects approval of non-pending', async () => {
    await makeUser('ap3');
    const req = await removalRequestService.createManual('admin', {
      targetDiscordId: 'ap3',
      description: 'test',
    });
    await removalRequestService.dismissRemoval('admin', req._id, { reason: 'appealed' });
    await expect(
      removalRequestService.approveRemoval('admin', req._id)
    ).rejects.toThrow(ConflictError);
  });

  test('throws NotFoundError for unknown id', async () => {
    await expect(
      removalRequestService.approveRemoval('admin', '000000000000000000000000')
    ).rejects.toThrow(NotFoundError);
  });
});

// ===========================================================================
describe('removalRequest.service — dismissRemoval', () => {
  test('dismisses and preserves strikes (D5)', async () => {
    const user = await makeUser('dm1');
    await strikeService.issueManualStrike('admin', { targetDiscordId: 'dm1', reason: 'aaa'});
    await strikeService.issueManualStrike('admin', { targetDiscordId: 'dm1', reason: 'bbb'});

    const req = await removalRequestService.createManual('admin', {
      targetDiscordId: 'dm1',
      description: 'test',
    });
    await removalRequestService.dismissRemoval('admin', req._id, { reason: 'appealed' });

    // D5: strikes persist.
    const activeStrikes = await Strike.countDocuments({ user: user._id, status: 'ACTIVE' });
    expect(activeStrikes).toBe(2);

    const reloadedReq = await RemovalRequest.findById(req._id);
    expect(reloadedReq.status).toBe('DISMISSED');
  });
});

// ===========================================================================
describe('removalRequest.service — applyRemoval (job helper)', () => {
  test('flips user to LEFT_ROBLOX_GROUP and unassigns roles', async () => {
    // Set up user with role assignment.
    const role = await Role.findOne({ key: 'staff' });
    const user = await User.create({
      discordId: 'ar1',
      status: 'ACTIVE',
      quota: { exempt: false, exemptUntil: null, exemptReason: null, category: 'STAFF' },
    });
    await RoleAssignment.create({
      user: user._id,
      discordId: 'ar1',
      role: role._id,
      roleKey: role.key,
      assignedBy: 'admin',
      active: true,
    });

    const req = await removalRequestService.createManual('admin', {
      targetDiscordId: 'ar1',
      description: 'test',
    });
    await removalRequestService.approveRemoval('admin', req._id);

    // Simulate the job having run.
    const result = await removalRequestService.applyRemoval(req._id);
    expect(result.applied).toBe(true);
    expect(result.unassignedRoles).toContain('staff');

    const reloaded = await User.findById(user._id);
    expect(reloaded.status).toBe('LEFT_ROBLOX_GROUP');
    expect(reloaded.quota.category).toBe('NONE');

    const assign = await RoleAssignment.findOne({ user: user._id });
    expect(assign.active).toBe(false);
  });

  test('is idempotent — second call is a no-op', async () => {
    await makeUser('ar2');
    const req = await removalRequestService.createManual('admin', {
      targetDiscordId: 'ar2',
      description: 'test',
    });
    await removalRequestService.approveRemoval('admin', req._id);

    await removalRequestService.applyRemoval(req._id);
    const second = await removalRequestService.applyRemoval(req._id);
    expect(second.applied).toBe(false);
  });

  test('findDueRemovals returns approved-and-due requests', async () => {
    await makeUser('ar3');
    const req = await removalRequestService.createManual('admin', {
      targetDiscordId: 'ar3',
      description: 'test',
    });
    await removalRequestService.approveRemoval('admin', req._id);
    // Not yet due.
    const notDue = await removalRequestService.findDueRemovals();
    expect(notDue).toHaveLength(0);

    // Pretend time has passed by using a future asOf.
    const future = new Date(Date.now() + 10 * 86_400_000);
    const due = await removalRequestService.findDueRemovals(future);
    expect(due).toHaveLength(1);
  });
});
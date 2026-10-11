import { describe, test, expect, beforeEach } from '@jest/globals';
import { User, Strike, RemovalRequest, Settings } from '../src/models/index.js';
import * as strikeService from '../src/services/strike.service.js';
import * as removalRequestService from '../src/services/removalRequest.service.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await Strike.deleteMany({});
  await RemovalRequest.deleteMany({});
});

// ===========================================================================
describe('strike commands — service layer', () => {
  test('issueManualStrike creates an ACTIVE strike', async () => {
    await makeUser('u1');
    const strike = await strikeService.issueManualStrike('admin', {
      targetDiscordId: 'u1',
      reason: 'insubordination',
    });
    expect(strike.status).toBe('ACTIVE');
    expect(strike.type).toBe('MANUAL');
  });

  test('getActiveStrikes returns only ACTIVE', async () => {
    await makeUser('u2');
    const s1 = await strikeService.issueManualStrike('admin', {
      targetDiscordId: 'u2',
      reason: 'first',
    });
    await strikeService.issueManualStrike('admin', {
      targetDiscordId: 'u2',
      reason: 'second',
    });
    await strikeService.removeStrike('admin', s1._id, { reason: 'appealed' });

    const active = await strikeService.getActiveStrikes('u2');
    expect(active).toHaveLength(1);
  });

  test('recoverStrike sets RECOVERED', async () => {
    await makeUser('u3');
    const s = await strikeService.issueManualStrike('admin', {
      targetDiscordId: 'u3',
      reason: 'test',
    });
    const result = await strikeService.recoverStrike('admin', s._id, {
      reason: 'double quota hit',
      periodKey: '2026-W41',
    });
    expect(result.recovered).toBe(true);
    const reloaded = await Strike.findById(s._id);
    expect(reloaded.status).toBe('RECOVERED');
    expect(reloaded.recoveredInPeriodKey).toBe('2026-W41');
  });
});

// ===========================================================================
describe('strike commands — removal requests', () => {
  test('approveRemoval sets SUSPENDED and future effective date', async () => {
    const user = await makeUser('r1');
    const req = await removalRequestService.createManual('admin', {
      targetDiscordId: 'r1',
      description: 'test description',
    });
    const approved = await removalRequestService.approveRemoval('admin', req._id, {
      reason: 'confirmed',
    });
    expect(approved.status).toBe('APPROVED');
    expect(approved.removalEffectiveAt).toBeInstanceOf(Date);

    const reloaded = await User.findById(user._id);
    expect(reloaded.status).toBe('SUSPENDED');
  });

  test('approveRemoval rejects effective date less than 3 days out', async () => {
    await makeUser('r2');
    const req = await removalRequestService.createManual('admin', {
      targetDiscordId: 'r2',
      description: 'test description',
    });
    const tooSoon = new Date(Date.now() + 86_400_000);
    await expect(
      removalRequestService.approveRemoval('admin', req._id, { effectiveAt: tooSoon })
    ).rejects.toThrow();
  });

  test('dismissRemoval preserves strikes (D5)', async () => {
    const user = await makeUser('r3');
    await strikeService.issueManualStrike('admin', {
      targetDiscordId: 'r3',
      reason: 'strike one',
    });
    const req = await removalRequestService.createManual('admin', {
      targetDiscordId: 'r3',
      description: 'test',
    });
    await removalRequestService.dismissRemoval('admin', req._id, { reason: 'appealed' });
    const active = await Strike.countDocuments({ user: user._id, status: 'ACTIVE' });
    expect(active).toBe(1);
  });
});

// ===========================================================================
describe('strike commands — threshold auto-creation', () => {
  test('reaching threshold auto-creates a pending removal', async () => {
    await Settings.updateOne({ key: 'global' }, { $set: { 'strikes.removalThreshold': 2 } });
    await makeUser('t1');
    await strikeService.issueManualStrike('admin', {
      targetDiscordId: 't1',
      reason: 'first',
    });
    expect(await RemovalRequest.countDocuments({})).toBe(0);

    await strikeService.issueManualStrike('admin', {
      targetDiscordId: 't1',
      reason: 'second',
    });
    expect(await RemovalRequest.countDocuments({ discordId: 't1', status: 'PENDING' })).toBe(1);
  });
});
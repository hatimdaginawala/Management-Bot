import { describe, test, expect, beforeEach } from '@jest/globals';
import * as strikeService from '../src/services/strike.service.js';
import * as removalRequestService from '../src/services/removalRequest.service.js';
import { User, Strike, RemovalRequest, Settings } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { ValidationError, NotFoundError } from '../src/utils/errors.js';

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

const FAKE_PERIOD = { _id: '000000000000000000000099', periodKey: '2026-W41' };

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await Strike.deleteMany({});
  await RemovalRequest.deleteMany({});
});

// ===========================================================================
describe('strike.service — issueQuotaStrike', () => {
  test('creates a strike on first call', async () => {
    const user = await makeUser('q1');
    const result = await strikeService.issueQuotaStrike({
      user,
      period: FAKE_PERIOD,
      reason: 'test',
    });
    expect(result.created).toBe(true);
    expect(result.strike.status).toBe('ACTIVE');
    expect(result.strike.quotaPeriodKey).toBe('2026-W41');
  });

  test('is idempotent — second call returns created: false', async () => {
    const user = await makeUser('q2');
    const first = await strikeService.issueQuotaStrike({ user, period: FAKE_PERIOD });
    const second = await strikeService.issueQuotaStrike({ user, period: FAKE_PERIOD });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await Strike.countDocuments({ user: user._id })).toBe(1);
  });

  test('different periods → different strikes', async () => {
    const user = await makeUser('q3');
    await strikeService.issueQuotaStrike({ user, period: { periodKey: '2026-W41' } });
    await strikeService.issueQuotaStrike({ user, period: { periodKey: '2026-W42' } });
    expect(await Strike.countDocuments({ user: user._id })).toBe(2);
  });
});

// ===========================================================================
describe('strike.service — issueManualStrike', () => {
  test('creates a MANUAL strike', async () => {
    await makeUser('m1');
    const strike = await strikeService.issueManualStrike('admin', {
      targetDiscordId: 'm1',
      reason: 'insubordination',
    });
    expect(strike.type).toBe('MANUAL');
    expect(strike.issuedBy).toBe('admin');
    expect(strike.status).toBe('ACTIVE');
  });

  test('requires reason', async () => {
    await makeUser('m2');
    await expect(
      strikeService.issueManualStrike('admin', { targetDiscordId: 'm2', reason: '' })
    ).rejects.toThrow(ValidationError);
  });

  test('throws NotFoundError for unknown user', async () => {
    await expect(
      strikeService.issueManualStrike('admin', { targetDiscordId: 'nobody', reason: 'test' })
    ).rejects.toThrow(NotFoundError);
  });
});

// ===========================================================================
describe('strike.service — removeStrike / recoverStrike', () => {
  test('removeStrike cancels an ACTIVE strike', async () => {
    const user = await makeUser('r1');
    const strike = await strikeService.issueManualStrike('admin', {
      targetDiscordId: 'r1',
      reason: 'test',
    });
    const result = await strikeService.removeStrike('admin', strike._id, { reason: 'appealed' });
    expect(result.removed).toBe(true);
    const reloaded = await Strike.findById(strike._id);
    expect(reloaded.status).toBe('CANCELLED');
  });

  test('removeStrike is idempotent', async () => {
    const user = await makeUser('r2');
    const strike = await strikeService.issueManualStrike('admin', { targetDiscordId: 'r2', reason: 'test' });
    await strikeService.removeStrike('admin', strike._id);
    const second = await strikeService.removeStrike('admin', strike._id);
    expect(second.removed).toBe(false);
  });

  test('recoverStrike sets RECOVERED and periodKey', async () => {
    const user = await makeUser('rc1');
    const strike = await strikeService.issueManualStrike('admin', { targetDiscordId: 'rc1', reason: 'test' });
    const result = await strikeService.recoverStrike('admin', strike._id, {
      reason: 'earned',
      periodKey: '2026-W42',
    });
    expect(result.recovered).toBe(true);
    const reloaded = await Strike.findById(strike._id);
    expect(reloaded.status).toBe('RECOVERED');
    expect(reloaded.recoveredInPeriodKey).toBe('2026-W42');
  });
});

// ===========================================================================
describe('strike.service — resetStrikesOnRejoin (D10)', () => {
  test('cancels all ACTIVE strikes with a distinct reason', async () => {
    const user = await makeUser('rj1');
    await strikeService.issueManualStrike('admin', { targetDiscordId: 'rj1', reason: 'one' });
    await strikeService.issueManualStrike('admin', { targetDiscordId: 'rj1', reason: 'two' });

    const result = await strikeService.resetStrikesOnRejoin('admin', 'rj1');
    expect(result.reset).toBe(2);

    const remaining = await Strike.find({ user: user._id });
    expect(remaining.every((s) => s.status === 'CANCELLED')).toBe(true);
    expect(remaining.every((s) => s.resolutionReason === 'rejoin reset (D10)')).toBe(true);
  });
});

// ===========================================================================
describe('strike.service — threshold triggers removal request', () => {
  test('reaching threshold creates a pending removal', async () => {
    await Settings.updateOne({ key: 'global' }, { $set: { 'strikes.removalThreshold': 2 } });
    await makeUser('th1');
    await strikeService.issueManualStrike('admin', { targetDiscordId: 'th1', reason: 'aaa'});
    // First strike — no removal yet.
    expect(await RemovalRequest.countDocuments({})).toBe(0);

    await strikeService.issueManualStrike('admin', { targetDiscordId: 'th1', reason: 'bbb'});
    // Second strike — threshold hit.
    const pending = await RemovalRequest.findOne({ discordId: 'th1', status: 'PENDING' });
    expect(pending).not.toBeNull();
  });

  test('extra strikes above threshold do not duplicate pending removal', async () => {
    await Settings.updateOne({ key: 'global' }, { $set: { 'strikes.removalThreshold': 2 } });
    await makeUser('th2');
for (let i = 0; i < 5; i++) {
  await strikeService.issueManualStrike('admin', { targetDiscordId: 'th2', reason: `strike ${i}` });
}
    const count = await RemovalRequest.countDocuments({ discordId: 'th2', status: 'PENDING' });
    expect(count).toBe(1);
  });
});

// ===========================================================================
describe('strike.service — reads', () => {
  test('getActiveStrikes returns only ACTIVE', async () => {
    await makeUser('rd1');
    const s1 = await strikeService.issueManualStrike('admin', { targetDiscordId: 'rd1', reason: 'aaa'});
    await strikeService.issueManualStrike('admin', { targetDiscordId: 'rd1', reason: 'bbb'});
    await strikeService.removeStrike('admin', s1._id);

    const active = await strikeService.getActiveStrikes('rd1');
    expect(active).toHaveLength(1);
  });

  test('countActiveStrikes works', async () => {
    await makeUser('rd2');
    await strikeService.issueManualStrike('admin', { targetDiscordId: 'rd2', reason: 'aaa'});
    expect(await strikeService.countActiveStrikes('rd2')).toBe(1);
  });
});
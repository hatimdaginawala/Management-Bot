import { describe, test, expect, beforeEach } from '@jest/globals';
import * as noticeService from '../src/services/notice.service.js';
import { User, Notice } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { ValidationError, NotFoundError } from '../src/utils/errors.js';

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

const DAY = 86_400_000;

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await Notice.deleteMany({});
});

// ===========================================================================
describe('notice.service — createNotice', () => {
  test('creates an ACTIVE INACTIVITY notice with default exemption', async () => {
    await makeUser('n1');
    const notice = await noticeService.createNotice('admin', {
      targetDiscordId: 'n1',
      type: 'INACTIVITY',
      reason: 'reported absent',
    });
    expect(notice.status).toBe('ACTIVE');
    expect(notice.grantsQuotaExemption).toBe(true);
  });

  test('WARNING does not grant exemption by default', async () => {
    await makeUser('n2');
    const notice = await noticeService.createNotice('admin', {
      targetDiscordId: 'n2',
      type: 'WARNING',
      reason: 'minor infraction',
    });
    expect(notice.grantsQuotaExemption).toBe(false);
  });

  test('caller can override exemption flag', async () => {
    await makeUser('n3');
    const notice = await noticeService.createNotice('admin', {
      targetDiscordId: 'n3',
      type: 'WARNING',
      reason: 'test',
      grantsQuotaExemption: true,
    });
    expect(notice.grantsQuotaExemption).toBe(true);
  });

  test('rejects invalid type', async () => {
    await makeUser('n4');
    await expect(
      noticeService.createNotice('admin', {
        targetDiscordId: 'n4',
        type: 'BOGUS',
        reason: 'test',
      })
    ).rejects.toThrow(ValidationError);
  });

  test('rejects missing reason', async () => {
    await makeUser('n5');
    await expect(
      noticeService.createNotice('admin', {
        targetDiscordId: 'n5',
        type: 'INACTIVITY',
        reason: '',
      })
    ).rejects.toThrow(ValidationError);
  });

  test('rejects unknown user', async () => {
    await expect(
      noticeService.createNotice('admin', {
        targetDiscordId: 'nobody',
        type: 'INACTIVITY',
        reason: 'test',
      })
    ).rejects.toThrow(NotFoundError);
  });

  test('rejects endAt <= startAt', async () => {
    await makeUser('n6');
    await expect(
      noticeService.createNotice('admin', {
        targetDiscordId: 'n6',
        type: 'INACTIVITY',
        reason: 'test',
        startAt: new Date(Date.now() + 5 * DAY),
        endAt: new Date(Date.now() + 1 * DAY),
      })
    ).rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
describe('notice.service — cancelNotice', () => {
  test('cancels an ACTIVE notice', async () => {
    await makeUser('c1');
    const notice = await noticeService.createNotice('admin', {
      targetDiscordId: 'c1',
      type: 'INACTIVITY',
      reason: 'test',
    });
    const result = await noticeService.cancelNotice('admin', notice._id, { reason: 'returned' });
    expect(result.cancelled).toBe(true);
    expect(result.notice.status).toBe('CANCELLED');
  });

  test('cancelNotice is idempotent', async () => {
    await makeUser('c2');
    const notice = await noticeService.createNotice('admin', {
      targetDiscordId: 'c2',
      type: 'WARNING',
      reason: 'test',
    });
    await noticeService.cancelNotice('admin', notice._id);
    const second = await noticeService.cancelNotice('admin', notice._id);
    expect(second.cancelled).toBe(false);
  });
});

// ===========================================================================
describe('notice.service — expireNotices', () => {
  test('expires ACTIVE notices with endAt in the past', async () => {
    await makeUser('x1');
    const notice = await noticeService.createNotice('admin', {
      targetDiscordId: 'x1',
      type: 'INACTIVITY',
      reason: 'test',
      endAt: new Date(Date.now() + 1 * DAY),
    });

    const future = new Date(Date.now() + 10 * DAY);
    const count = await noticeService.expireNotices({ asOf: future });
    expect(count).toBe(1);

    const reloaded = await Notice.findById(notice._id);
    expect(reloaded.status).toBe('EXPIRED');
  });

  test('open-ended notices (endAt = null) never expire', async () => {
    await makeUser('x2');
    await noticeService.createNotice('admin', {
      targetDiscordId: 'x2',
      type: 'INACTIVITY',
      reason: 'test',
      endAt: null,
    });

    const future = new Date(Date.now() + 1000 * DAY);
    const count = await noticeService.expireNotices({ asOf: future });
    expect(count).toBe(0);
  });

  test('expireNotices is idempotent', async () => {
    await makeUser('x3');
    await noticeService.createNotice('admin', {
      targetDiscordId: 'x3',
      type: 'INACTIVITY',
      reason: 'test',
      endAt: new Date(Date.now() + 1 * DAY),
    });

    const future = new Date(Date.now() + 10 * DAY);
    const first = await noticeService.expireNotices({ asOf: future });
    const second = await noticeService.expireNotices({ asOf: future });
    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});

// ===========================================================================
describe('notice.service — reads', () => {
  test('getActiveNoticesForUser returns only ACTIVE', async () => {
    await makeUser('rd1');
    const n1 = await noticeService.createNotice('admin', {
      targetDiscordId: 'rd1',
      type: 'INACTIVITY',
      reason: 'test',
    });
    await noticeService.createNotice('admin', {
      targetDiscordId: 'rd1',
      type: 'WARNING',
      reason: 'test',
    });
    await noticeService.cancelNotice('admin', n1._id);

    const active = await noticeService.getActiveNoticesForUser('rd1');
    expect(active).toHaveLength(1);
    expect(active[0].type).toBe('WARNING');
  });

  test('hasActiveExemptNotice returns true only for exempt notices', async () => {
    const user = await makeUser('rd2');
    // WARNING — no exemption.
    await noticeService.createNotice('admin', {
      targetDiscordId: 'rd2',
      type: 'WARNING',
      reason: 'test',
    });
    expect(await noticeService.hasActiveExemptNotice(user._id)).toBe(false);

    // Add an INACTIVITY notice with exemption.
    await noticeService.createNotice('admin', {
      targetDiscordId: 'rd2',
      type: 'INACTIVITY',
      reason: 'test',
    });
    expect(await noticeService.hasActiveExemptNotice(user._id)).toBe(true);
  });

  test('hasActiveExemptNotice respects endAt', async () => {
    const user = await makeUser('rd3');
    await noticeService.createNotice('admin', {
      targetDiscordId: 'rd3',
      type: 'INACTIVITY',
      reason: 'test',
      endAt: new Date(Date.now() + 1 * DAY),
    });

    const future = new Date(Date.now() + 10 * DAY);
    expect(await noticeService.hasActiveExemptNotice(user._id, future)).toBe(false);
  });

  test('listNotices filters by type and status', async () => {
    await makeUser('l1');
    await makeUser('l2');
    await noticeService.createNotice('admin', {
      targetDiscordId: 'l1',
      type: 'INACTIVITY',
      reason: 'test',
    });
    await noticeService.createNotice('admin', {
      targetDiscordId: 'l2',
      type: 'WARNING',
      reason: 'test',
    });

    const inactive = await noticeService.listNotices({ type: 'INACTIVITY' });
    expect(inactive.total).toBe(1);

    const warnings = await noticeService.listNotices({ type: 'WARNING' });
    expect(warnings.total).toBe(1);
  });
});
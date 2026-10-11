import { describe, test, expect, beforeEach } from '@jest/globals';
import { User, Leave, Notice } from '../src/models/index.js';
import * as leaveService from '../src/services/leave.service.js';
import * as noticeService from '../src/services/notice.service.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

const DAY = 86_400_000;

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await Leave.deleteMany({});
  await Notice.deleteMany({});
});

// ===========================================================================
describe('leave commands — service layer', () => {
  test('createLeaveRequest creates PENDING', async () => {
    await makeUser('u1');
    const leave = await leaveService.createLeaveRequest('u1', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 3 * DAY),
      reason: 'vacation',
    });
    expect(leave.status).toBe('PENDING');
  });

  test('overlapping leaves are rejected', async () => {
    await makeUser('u2');
    await leaveService.createLeaveRequest('u2', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'first',
    });
    await expect(
      leaveService.createLeaveRequest('u2', {
        startAt: new Date(Date.now() + 3 * DAY),
        endAt: new Date(Date.now() + 7 * DAY),
        reason: 'overlap',
      })
    ).rejects.toThrow();
  });

  test('approveLeave sets APPROVED', async () => {
    await makeUser('u3');
    const leave = await leaveService.createLeaveRequest('u3', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 3 * DAY),
      reason: 'vacation',
    });
    const result = await leaveService.approveLeave('admin', leave._id);
    expect(result.approved).toBe(true);
    expect(result.leave.status).toBe('APPROVED');
  });

  test('endLeave sets EXPIRED', async () => {
    await makeUser('u4');
    const leave = await leaveService.createLeaveRequest('u4', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 3 * DAY),
      reason: 'vacation',
    });
    await leaveService.approveLeave('admin', leave._id);
    const result = await leaveService.endLeave('admin', leave._id, { reason: 'returned early' });
    expect(result.ended).toBe(true);
    expect(result.leave.status).toBe('EXPIRED');
  });

  test('cancelLeave sets CANCELLED', async () => {
    await makeUser('u5');
    const leave = await leaveService.createLeaveRequest('u5', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 3 * DAY),
      reason: 'vacation',
    });
    const result = await leaveService.cancelLeave('u5', leave._id);
    expect(result.cancelled).toBe(true);
    expect(result.leave.status).toBe('CANCELLED');
  });
});

// ===========================================================================
describe('notice commands — service layer', () => {
  test('createNotice with default exemption for INACTIVITY', async () => {
    await makeUser('n1');
    const notice = await noticeService.createNotice('admin', {
      targetDiscordId: 'n1',
      type: 'INACTIVITY',
      reason: 'away',
    });
    expect(notice.grantsQuotaExemption).toBe(true);
  });

  test('WARNING notice does not grant exemption by default', async () => {
    await makeUser('n2');
    const notice = await noticeService.createNotice('admin', {
      targetDiscordId: 'n2',
      type: 'WARNING',
      reason: 'test',
    });
    expect(notice.grantsQuotaExemption).toBe(false);
  });

  test('cancelNotice sets CANCELLED', async () => {
    await makeUser('n3');
    const notice = await noticeService.createNotice('admin', {
      targetDiscordId: 'n3',
      type: 'INACTIVITY',
      reason: 'test',
    });
    const result = await noticeService.cancelNotice('admin', notice._id, { reason: 'returned' });
    expect(result.cancelled).toBe(true);
    expect(result.notice.status).toBe('CANCELLED');
  });

  test('hasActiveExemptNotice detects exemption', async () => {
    const user = await makeUser('n4');
    await noticeService.createNotice('admin', {
      targetDiscordId: 'n4',
      type: 'INACTIVITY',
      reason: 'test',
    });
    expect(await noticeService.hasActiveExemptNotice(user._id)).toBe(true);
  });
});
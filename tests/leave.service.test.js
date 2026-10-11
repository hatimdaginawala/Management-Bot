import { describe, test, expect, beforeEach } from '@jest/globals';
import * as leaveService from '../src/services/leave.service.js';
import { User, Leave } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { ValidationError, NotFoundError, ConflictError } from '../src/utils/errors.js';

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

const DAY = 86_400_000;

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await Leave.deleteMany({});
});

// ===========================================================================
describe('leave.service — createLeaveRequest', () => {
  test('creates a PENDING leave', async () => {
    await makeUser('u1');
    const leave = await leaveService.createLeaveRequest('u1', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });
    expect(leave.status).toBe('PENDING');
    expect(leave.discordId).toBe('u1');
  });

  test('rejects end <= start', async () => {
    await makeUser('u2');
    await expect(
      leaveService.createLeaveRequest('u2', {
        startAt: new Date(Date.now() + 5 * DAY),
        endAt: new Date(Date.now() + 1 * DAY),
        reason: 'bad dates',
      })
    ).rejects.toThrow(ValidationError);
  });

  test('rejects short reason', async () => {
    await makeUser('u3');
    await expect(
      leaveService.createLeaveRequest('u3', {
        startAt: new Date(Date.now() + 1 * DAY),
        endAt: new Date(Date.now() + 5 * DAY),
        reason: 'a',
      })
    ).rejects.toThrow(ValidationError);
  });

  test('rejects unknown user', async () => {
    await expect(
      leaveService.createLeaveRequest('nobody', {
        startAt: new Date(Date.now() + 1 * DAY),
        endAt: new Date(Date.now() + 5 * DAY),
        reason: 'vacation',
      })
    ).rejects.toThrow(NotFoundError);
  });

  test('rejects overlapping pending leave', async () => {
    await makeUser('u4');
    await leaveService.createLeaveRequest('u4', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 10 * DAY),
      reason: 'vacation',
    });
    await expect(
      leaveService.createLeaveRequest('u4', {
        startAt: new Date(Date.now() + 5 * DAY),
        endAt: new Date(Date.now() + 15 * DAY),
        reason: 'extended',
      })
    ).rejects.toThrow(ConflictError);
  });

test('allows a new PENDING leave after an APPROVED one has expired', async () => {
  await makeUser('u5');
  const first = await leaveService.createLeaveRequest('u5', {
    startAt: new Date(Date.now() + 1 * DAY),
    endAt: new Date(Date.now() + 3 * DAY),
    reason: 'first',
  });
  await leaveService.approveLeave('admin', first._id);
  await leaveService.endLeave('admin', first._id);

  const second = await leaveService.createLeaveRequest('u5', {
    startAt: new Date(Date.now() + 10 * DAY),
    endAt: new Date(Date.now() + 15 * DAY),
    reason: 'second',
  });
  expect(second.status).toBe('PENDING');
});
});

// ===========================================================================
describe('leave.service — approveLeave', () => {
  test('approves a pending leave', async () => {
    await makeUser('a1');
    const leave = await leaveService.createLeaveRequest('a1', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });

    const result = await leaveService.approveLeave('admin', leave._id);
    expect(result.approved).toBe(true);
    expect(result.leave.status).toBe('APPROVED');
    expect(result.leave.reviewedBy).toBe('admin');
  });

  test('is idempotent — re-approve returns alreadyApproved', async () => {
    await makeUser('a2');
    const leave = await leaveService.createLeaveRequest('a2', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });
    await leaveService.approveLeave('admin', leave._id);
    const second = await leaveService.approveLeave('admin', leave._id);
    expect(second.approved).toBe(false);
    expect(second.alreadyApproved).toBe(true);
  });

  test('cannot approve a rejected leave', async () => {
    await makeUser('a3');
    const leave = await leaveService.createLeaveRequest('a3', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });
    await leaveService.rejectLeave('admin', leave._id, { reason: 'too short notice' });
    await expect(
      leaveService.approveLeave('admin', leave._id)
    ).rejects.toThrow(ConflictError);
  });
});

// ===========================================================================
describe('leave.service — rejectLeave', () => {
  test('requires a reason', async () => {
    await makeUser('r1');
    const leave = await leaveService.createLeaveRequest('r1', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });
    await expect(
      leaveService.rejectLeave('admin', leave._id, { reason: '' })
    ).rejects.toThrow(ValidationError);
  });

  test('rejects and stores reason', async () => {
    await makeUser('r2');
    const leave = await leaveService.createLeaveRequest('r2', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });
    const rejected = await leaveService.rejectLeave('admin', leave._id, {
      reason: 'too short notice',
    });
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.reviewReason).toBe('too short notice');
  });
});

// ===========================================================================
describe('leave.service — endLeave / cancelLeave', () => {
  test('endLeave transitions APPROVED → EXPIRED', async () => {
    await makeUser('e1');
    const leave = await leaveService.createLeaveRequest('e1', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });
    await leaveService.approveLeave('admin', leave._id);
    const result = await leaveService.endLeave('admin', leave._id, { reason: 'returned early' });
    expect(result.ended).toBe(true);
    expect(result.leave.status).toBe('EXPIRED');
  });

  test('endLeave is a no-op on a non-approved leave', async () => {
    await makeUser('e2');
    const leave = await leaveService.createLeaveRequest('e2', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });
    const result = await leaveService.endLeave('admin', leave._id);
    expect(result.ended).toBe(false);
  });

  test('cancelLeave transitions PENDING → CANCELLED', async () => {
    await makeUser('c1');
    const leave = await leaveService.createLeaveRequest('c1', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });
    const result = await leaveService.cancelLeave('c1', leave._id);
    expect(result.cancelled).toBe(true);
    expect(result.leave.status).toBe('CANCELLED');
  });
});

// ===========================================================================
describe('leave.service — expireLeaves', () => {
  test('expires approved leaves whose endAt has passed', async () => {
    await makeUser('x1');
    const leave = await leaveService.createLeaveRequest('x1', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 3 * DAY),
      reason: 'vacation',
    });
    await leaveService.approveLeave('admin', leave._id);

    // Simulate time passing by using a future asOf.
    const future = new Date(Date.now() + 10 * DAY);
    const count = await leaveService.expireLeaves({ asOf: future });
    expect(count).toBe(1);

    const reloaded = await Leave.findById(leave._id);
    expect(reloaded.status).toBe('EXPIRED');
  });

  test('expireLeaves is idempotent', async () => {
    await makeUser('x2');
    const leave = await leaveService.createLeaveRequest('x2', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 3 * DAY),
      reason: 'vacation',
    });
    await leaveService.approveLeave('admin', leave._id);

    const future = new Date(Date.now() + 10 * DAY);
    const first = await leaveService.expireLeaves({ asOf: future });
    const second = await leaveService.expireLeaves({ asOf: future });
    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});

// ===========================================================================
describe('leave.service — reads', () => {
  test('getActiveLeaveForUser returns the currently-active approved leave', async () => {
    await makeUser('rd1');
    const leave = await leaveService.createLeaveRequest('rd1', {
      startAt: new Date(Date.now() - 1 * DAY),
      endAt: new Date(Date.now() + 3 * DAY),
      reason: 'vacation',
    });
    await leaveService.approveLeave('admin', leave._id);

    const active = await leaveService.getActiveLeaveForUser('rd1');
    expect(active).not.toBeNull();
    expect(String(active._id)).toBe(String(leave._id));
  });

  test('hasApprovedLeaveOverlapping works', async () => {
    const user = await makeUser('rd2');
    const leave = await leaveService.createLeaveRequest('rd2', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });
    await leaveService.approveLeave('admin', leave._id);

    const period = {
      startAt: new Date(Date.now()),
      endAt: new Date(Date.now() + 10 * DAY),
    };
    expect(await leaveService.hasApprovedLeaveOverlapping(user._id, period)).toBe(true);

    const farPeriod = {
      startAt: new Date(Date.now() + 100 * DAY),
      endAt: new Date(Date.now() + 110 * DAY),
    };
    expect(await leaveService.hasApprovedLeaveOverlapping(user._id, farPeriod)).toBe(false);
  });

  test('listLeaves filters by status', async () => {
    await makeUser('l1');
    await makeUser('l2');
    const p = await leaveService.createLeaveRequest('l1', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 3 * DAY),
      reason: 'vacation',
    });
    await leaveService.createLeaveRequest('l2', {
      startAt: new Date(Date.now() + 5 * DAY),
      endAt: new Date(Date.now() + 8 * DAY),
      reason: 'other',
    });
    await leaveService.approveLeave('admin', p._id);

    const approved = await leaveService.listLeaves({ status: 'APPROVED' });
    expect(approved.total).toBe(1);
    const pending = await leaveService.listLeaves({ status: 'PENDING' });
    expect(pending.total).toBe(1);
  });
});
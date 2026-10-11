import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { User, Leave, Settings } from '../src/models/index.js';
import * as leaveService from '../src/services/leave.service.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';

const DAY = 86_400_000;

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

function makeMockClient() {
  const sent = [];
  return {
    users: {
      fetch: jest.fn(async (discordId) => ({
        id: discordId,
        send: jest.fn(async (payload) => {
          sent.push({ discordId, payload });
          return { id: 'msg-1' };
        }),
      })),
    },
    __sent: sent,
  };
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await Leave.deleteMany({});
});

// ===========================================================================
describe('leave DMs — approve', () => {
  test('approving sends a DM to the requester with approver mention', async () => {
    await makeUser('u1');
    const leave = await leaveService.createLeaveRequest('u1', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });

    const client = makeMockClient();

    // Simulate the picker's flow: approve, then DM.
    const { leave: approved } = await leaveService.approveLeave('admin-1', leave._id);
    const { dmLeaveUser } = await import('../src/bot/utils/leaveDm.js');
    const { COLORS } = await import('../src/bot/embedBuilders.js');

    await dmLeaveUser(client, approved, {
      title: 'Leave Approved',
      color: COLORS.SUCCESS,
      actorId: 'admin-1',
      actorLabel: 'Approved By',
      extraLine: 'Your leave has been approved.',
    });

    expect(client.__sent).toHaveLength(1);
    const embed = client.__sent[0].payload.embeds[0].data;
    expect(embed.title).toBe('Leave Approved');
    // Should contain the approver as a mention, not a raw ID.
    const approverField = embed.fields.find((f) => f.name === 'Approved By');
    expect(approverField?.value).toContain('<@admin-1>');
    // Should contain a "Period" field.
    expect(embed.fields.some((f) => f.name === 'Period')).toBe(true);
  });

  test('DM is skipped when dmAffectedUser is disabled', async () => {
    await Settings.updateOne(
      { key: 'global' },
      { $set: { 'notifications.dmAffectedUser': false } }
    );
    await makeUser('u2');
    const leave = await leaveService.createLeaveRequest('u2', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });
    const { leave: approved } = await leaveService.approveLeave('admin-1', leave._id);

    const client = makeMockClient();
    const { dmLeaveUser } = await import('../src/bot/utils/leaveDm.js');
    const { COLORS } = await import('../src/bot/embedBuilders.js');

    await dmLeaveUser(client, approved, {
      title: 'Leave Approved',
      color: COLORS.SUCCESS,
    });

    expect(client.__sent).toHaveLength(0);
    expect(client.users.fetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe('leave DMs — reject', () => {
  test('rejecting sends a DM with reviewer and reason', async () => {
    await makeUser('u3');
    const leave = await leaveService.createLeaveRequest('u3', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 5 * DAY),
      reason: 'vacation',
    });

    const rejected = await leaveService.rejectLeave('admin-2', leave._id, {
      reason: 'too short notice',
    });

    const client = makeMockClient();
    const { dmLeaveUser } = await import('../src/bot/utils/leaveDm.js');
    const { COLORS } = await import('../src/bot/embedBuilders.js');

    await dmLeaveUser(client, rejected, {
      title: 'Leave Rejected',
      color: COLORS.ERROR,
      actorId: 'admin-2',
      actorLabel: 'Reviewed By',
      reason: 'too short notice',
    });

    const embed = client.__sent[0].payload.embeds[0].data;
    expect(embed.title).toBe('Leave Rejected');
    const reviewerField = embed.fields.find((f) => f.name === 'Reviewed By');
    expect(reviewerField?.value).toContain('<@admin-2>');
    const reasonField = embed.fields.find((f) => f.name === 'Reviewer Reason');
    expect(reasonField?.value).toBe('too short notice');
  });
});

// ===========================================================================
describe('leave DMs — expire', () => {
  test('expireLeaves returns count; pre-fetch approach preserves data for DM', async () => {
    await makeUser('u4');
    const leave = await leaveService.createLeaveRequest('u4', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 2 * DAY),
      reason: 'vacation',
    });
    await leaveService.approveLeave('admin-3', leave._id);

    // Pre-fetch (as the job does).
    const dueLeaves = await Leave.find({
      status: 'APPROVED',
      endAt: { $lte: new Date(Date.now() + 10 * DAY) },
    })
      .select('_id discordId startAt endAt reason status')
      .lean();
    expect(dueLeaves.length).toBeGreaterThanOrEqual(1);

    // Expire.
    const count = await leaveService.expireLeaves({
      asOf: new Date(Date.now() + 10 * DAY),
    });
    expect(count).toBeGreaterThanOrEqual(1);

    // DM with the pre-fetched data.
    const client = makeMockClient();
    const { dmLeaveUser } = await import('../src/bot/utils/leaveDm.js');
    const { COLORS } = await import('../src/bot/embedBuilders.js');

    for (const l of dueLeaves) {
      await dmLeaveUser(client, l, {
        title: 'Leave Ended',
        color: COLORS.INFO,
        extraLine: 'Your leave has ended.',
      });
    }

    expect(client.__sent.length).toBeGreaterThanOrEqual(1);
    const embed = client.__sent[0].payload.embeds[0].data;
    expect(embed.title).toBe('Leave Ended');
  });
});

// ===========================================================================
describe('leave DMs — failure does not throw', () => {
  test('a DM failure is logged and swallowed', async () => {
    await makeUser('u5');
    const leave = await leaveService.createLeaveRequest('u5', {
      startAt: new Date(Date.now() + 1 * DAY),
      endAt: new Date(Date.now() + 3 * DAY),
      reason: 'test',
    });
    const { leave: approved } = await leaveService.approveLeave('admin-4', leave._id);

    const failingClient = {
      users: {
        fetch: jest.fn(async () => ({
          id: 'u5',
          send: jest.fn(async () => {
            throw new Error('DMs closed');
          }),
        })),
      },
    };

    const { dmLeaveUser } = await import('../src/bot/utils/leaveDm.js');
    const { COLORS } = await import('../src/bot/embedBuilders.js');

    // Should not throw.
    await expect(
      dmLeaveUser(failingClient, approved, {
        title: 'Leave Approved',
        color: COLORS.SUCCESS,
      })
    ).resolves.toBeUndefined();
  });
});
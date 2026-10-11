import { describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import * as statisticsService from '../src/services/statistics.service.js';
import * as eventService from '../src/services/event.service.js';
import * as strikeService from '../src/services/strike.service.js';
import { User, Event, Attendance, Strike, QuotaResult, Leave, SyncLog } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { seedEventTypes } from '../scripts/seedEventTypes.js';
import { NotFoundError } from '../src/utils/errors.js';

const TEN_MINUTES = 10 * 60 * 1000;

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

/**
 * Create an APPROVED event for the given host + attendees, and
 * immediately backdate the cooldownAnchor so subsequent events by the
 * same host are not blocked by the 5-minute cooldown. Tests that need
 * multiple events from the same host use this helper.
 */
async function makeApprovedEvent(hostId, attendeeIds) {
  const event = await eventService.createEvent(hostId, {
    eventTypeKey: 'patrol',
    proofUrl: 'https://example.com/x.png',
    attendees: attendeeIds.map((d) => ({ discordId: d })),
  });
  await Event.updateOne(
    { _id: event._id },
    { $set: { cooldownAnchor: new Date(Date.now() - TEN_MINUTES) } }
  );
  await eventService.approveEvent('admin', event._id);
  return event;
}

/**
 * Same idea but lets the caller choose the event type. Useful for
 * byType aggregations.
 */
async function makeApprovedEventTyped(hostId, attendeeIds, eventTypeKey) {
  const event = await eventService.createEvent(hostId, {
    eventTypeKey,
    proofUrl: 'https://example.com/x.png',
    attendees: attendeeIds.map((d) => ({ discordId: d })),
  });
  await Event.updateOne(
    { _id: event._id },
    { $set: { cooldownAnchor: new Date(Date.now() - TEN_MINUTES) } }
  );
  await eventService.approveEvent('admin', event._id);
  return event;
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await seedEventTypes();
  await Event.deleteMany({});
  await Attendance.deleteMany({});
  await Strike.deleteMany({});
  await QuotaResult.deleteMany({});
  await Leave.deleteMany({});
  await SyncLog.deleteMany({});
});

// ===========================================================================
describe('statistics.service — windowSummary', () => {
  test('empty DB returns zeros', async () => {
    const result = await statisticsService.dailyStats();
    expect(result.summary.totalEvents).toBe(0);
    expect(result.summary.totalAttendance).toBe(0);
    expect(result.eventsByType).toEqual([]);
    expect(result.topHosts).toEqual([]);
  });

  test("dailyStats counts today's approved events", async () => {
    await makeUser('h1');
    await makeUser('a1');
    await makeUser('a2');
    await makeApprovedEvent('h1', ['a1', 'a2']);

    const result = await statisticsService.dailyStats();
    expect(result.summary.totalEvents).toBe(1);
    expect(result.summary.totalAttendance).toBe(2);
    expect(result.topHosts[0].discordId).toBe('h1');
    expect(result.eventsByType[0].typeKey).toBe('patrol');
  });

  test('dailyStats with asOf in the past returns zero', async () => {
    await makeUser('h2');
    await makeUser('a1');
    await makeApprovedEvent('h2', ['a1']);

    const past = new Date(Date.now() - 100 * 86_400_000);
    const result = await statisticsService.dailyStats({ asOf: past });
    expect(result.summary.totalEvents).toBe(0);
  });

  test('weeklyStats includes a periodKey', async () => {
    const result = await statisticsService.weeklyStats();
    expect(result.kind).toBe('weekly');
    expect(result.periodKey).toMatch(/^\d{4}-W\d{2}$/);
  });

  test('monthlyStats includes a month range', async () => {
    const result = await statisticsService.monthlyStats();
    expect(result.kind).toBe('monthly');
    expect(new Date(result.startAt).getUTCDate()).toBe(1);
  });

  test('newStrikes counted correctly', async () => {
    await makeUser('h3');
    await strikeService.issueManualStrike('admin', {
      targetDiscordId: 'h3',
      reason: 'test strike',
    });
    const result = await statisticsService.dailyStats();
    expect(result.summary.newStrikes).toBe(1);
  });
});

// ===========================================================================
describe('statistics.service — userStats', () => {
  test('returns full profile for a user', async () => {
    await makeUser('us1');
    await makeUser('us2');
    await makeApprovedEvent('us1', ['us2']);

    const stats = await statisticsService.userStats('us1');
    expect(stats.user.discordId).toBe('us1');
    expect(stats.activity.totalEventsHosted).toBe(1);
    expect(stats.activity.totalEventsAttended).toBe(0);
  });

  test('throws NotFoundError for unknown user', async () => {
    await expect(statisticsService.userStats('nobody')).rejects.toThrow(NotFoundError);
  });
});

// ===========================================================================
describe('statistics.service — eventStats', () => {
  test('aggregates by status and type', async () => {
    await makeUser('eh1');
    await makeUser('ea1');

    // One APPROVED patrol
    await makeApprovedEventTyped('eh1', ['ea1'], 'patrol');

    // One PENDING raid (created directly, no approval)
    await eventService.createEvent('eh1', {
      eventTypeKey: 'raid',
      proofUrl: 'https://example.com/y.png',
      attendees: [{ discordId: 'ea1' }],
    });

    const stats = await statisticsService.eventStats();
    expect(stats.total).toBe(2);
    expect(stats.byStatus.APPROVED).toBe(1);
    expect(stats.byStatus.PENDING).toBe(1);
    expect(stats.byType.find((t) => t.typeKey === 'patrol')?.count).toBe(1);
    expect(stats.byType.find((t) => t.typeKey === 'raid')?.count).toBe(1);
  });
});

// ===========================================================================
describe('statistics.service — attendanceStats', () => {
  test('computes unique attendees and avg per event', async () => {
    await makeUser('ah1');
    await makeUser('aa1');
    await makeUser('aa2');
    await makeApprovedEvent('ah1', ['aa1', 'aa2']);

    const stats = await statisticsService.attendanceStats();
    expect(stats.totalAttendance).toBe(2);
    expect(stats.uniqueAttendees).toBe(2);
    expect(stats.uniqueEvents).toBe(1);
    expect(stats.avgPerEvent).toBe(2);
  });
});

// ===========================================================================
describe('statistics.service — hostStats', () => {
  test('ranks hosts by approved event count', async () => {
    await makeUser('hh1');
    await makeUser('hh2');
    await makeUser('ha1');
    await makeApprovedEvent('hh1', ['ha1']);
    await makeApprovedEvent('hh1', ['ha1']); // cooldown bypassed by helper
    await makeApprovedEvent('hh2', ['ha1']);

    const stats = await statisticsService.hostStats({ top: 5 });
    expect(stats[0].discordId).toBe('hh1');
    expect(stats[0].count).toBe(2);
    expect(stats[1].discordId).toBe('hh2');
  });
});

// ===========================================================================
describe('statistics.service — quotaStats', () => {
  test('aggregates per category and status', async () => {
    const u1 = await makeUser('qh1');

    // Each row needs a DISTINCT period ObjectId because the unique
    // index is on (user, period, category).
    const periodA = new mongoose.Types.ObjectId();
    const periodB = new mongoose.Types.ObjectId();

    await QuotaResult.create([
      {
        period: periodA, periodKey: '2026-W40',
        user: u1._id, discordId: 'qh1',
        category: 'STAFF', metric: 'HOSTED_EVENTS',
        required: 5, actual: 5, status: 'MET',
      },
      {
        period: periodB, periodKey: '2026-W41',
        user: u1._id, discordId: 'qh1',
        category: 'STAFF', metric: 'HOSTED_EVENTS',
        required: 5, actual: 2, status: 'MISSED',
      },
    ]);

    const stats = await statisticsService.quotaStats();
    expect(stats.STAFF.MET).toBe(1);
    expect(stats.STAFF.MISSED).toBe(1);
    expect(stats.LOW_RANK.MET).toBe(0);
  });
});

// ===========================================================================
describe('statistics.service — strikeStats', () => {
  test('aggregates by status and lists top users', async () => {
    await makeUser('sh1');
    await strikeService.issueManualStrike('admin', { targetDiscordId: 'sh1', reason: 'aaa' });
    await strikeService.issueManualStrike('admin', { targetDiscordId: 'sh1', reason: 'bbb' });

    const stats = await statisticsService.strikeStats();
    expect(stats.total).toBe(2);
    expect(stats.byStatus.ACTIVE).toBe(2);
    expect(stats.topUsersWithActiveStrikes[0].discordId).toBe('sh1');
    expect(stats.topUsersWithActiveStrikes[0].count).toBe(2);
  });
});

// ===========================================================================
describe('statistics.service — syncStats', () => {
  test('returns last syncs and totals', async () => {
    await SyncLog.create([
      {
        type: 'ROBLOX_GROUP_SYNC', triggeredBy: 'system',
        startedAt: new Date(Date.now() - 1000),
        completedAt: new Date(), status: 'SUCCESS',
        membersFetched: 100, membersCreated: 5, membersUpdated: 10,
        rankChanges: 3, membersRemoved: 1,
      },
      {
        type: 'ROBLOX_GROUP_SYNC', triggeredBy: 'system',
        startedAt: new Date(Date.now() - 2000),
        completedAt: new Date(), status: 'PARTIAL',
        membersFetched: 80, membersCreated: 0, membersUpdated: 8,
        rankChanges: 2, membersRemoved: 0,
      },
    ]);

    const stats = await statisticsService.syncStats();
    expect(stats.lastSyncs).toHaveLength(2);
    expect(stats.totals.syncCount).toBe(2);
    expect(stats.totals.membersFetched).toBe(180);
    expect(stats.totals.rankChanges).toBe(5);
  });
});

// ===========================================================================
describe('statistics.service — memberBreakdown', () => {
  test('groups users by status and quota category', async () => {
    await User.create({ discordId: 'mb1', status: 'ACTIVE', quota: { category: 'STAFF' } });
    await User.create({ discordId: 'mb2', status: 'ACTIVE', quota: { category: 'LOW_RANK' } });
    await User.create({ discordId: 'mb3', status: 'UNVERIFIED' });

    const breakdown = await statisticsService.memberBreakdown();
    expect(breakdown.byStatus.ACTIVE).toBe(2);
    expect(breakdown.byStatus.UNVERIFIED).toBe(1);
    expect(breakdown.byQuotaCategory.STAFF).toBe(1);
    expect(breakdown.byQuotaCategory.LOW_RANK).toBe(1);
  });
});
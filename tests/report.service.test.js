import { describe, test, expect, beforeEach } from '@jest/globals';
import * as reportService from '../src/services/report.service.js';
import * as eventService from '../src/services/event.service.js';
import * as strikeService from '../src/services/strike.service.js';
import { User, Event, Attendance, Report, Strike } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { seedEventTypes } from '../scripts/seedEventTypes.js';
import { NotFoundError, ValidationError } from '../src/utils/errors.js';

const TEN_MINUTES = 10 * 60 * 1000;
const DAY = 86_400_000;

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

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

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await seedEventTypes();
  await Event.deleteMany({});
  await Attendance.deleteMany({});
  await Strike.deleteMany({});
  await Report.deleteMany({});
});

// ===========================================================================
describe('report.service — weekly', () => {
  test('generates and persists a weekly report', async () => {
    await makeUser('h1');
    await makeUser('a1');
    await makeApprovedEvent('h1', ['a1']);

    const report = await reportService.generateWeeklyReport({ generatedBy: 'admin' });
    expect(report.kind).toBe('WEEKLY');
    expect(report.reportKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(report.summary.totalEvents).toBe(1);
    expect(report.summary.totalAttendance).toBe(1);
    expect(report.renderedPayload).toBeDefined();
    expect(report.renderedPayload.embeds).toHaveLength(1);
  });

  test('is idempotent — re-run returns the same doc', async () => {
    await makeUser('h2');
    await makeUser('a1');
    await makeApprovedEvent('h2', ['a1']);

    const first = await reportService.generateWeeklyReport();
    const second = await reportService.generateWeeklyReport();
    expect(String(second._id)).toBe(String(first._id));

    const count = await Report.countDocuments({ kind: 'WEEKLY' });
    expect(count).toBe(1);
  });

  test('embed title includes reportKey', async () => {
    await makeUser('h3');
    await makeUser('a1');
    const report = await reportService.generateWeeklyReport();
    expect(report.renderedPayload.embeds[0].title).toContain(report.reportKey);
  });
});

// ===========================================================================
describe('report.service — monthly', () => {
  test('generates and persists a monthly report', async () => {
    await makeUser('mh1');
    await makeUser('ma1');
    await makeApprovedEvent('mh1', ['ma1']);

    const report = await reportService.generateMonthlyReport();
    expect(report.kind).toBe('MONTHLY');
    expect(report.reportKey).toMatch(/^\d{4}-\d{2}$/);
    expect(report.summary.totalEvents).toBe(1);
  });

  test('monthly is idempotent per month', async () => {
    await makeUser('mh2');
    await reportService.generateMonthlyReport();
    await reportService.generateMonthlyReport();
    const count = await Report.countDocuments({ kind: 'MONTHLY' });
    expect(count).toBe(1);
  });
});

// ===========================================================================
describe('report.service — manual', () => {
  test('allows multiple manual reports (no idempotency)', async () => {
    await makeUser('mh3');
    await makeUser('ma1');
    await makeApprovedEvent('mh3', ['ma1']);

    const from = new Date(Date.now() - 7 * DAY);
    const to = new Date();
    await reportService.generateManualReport({ from, to, generatedBy: 'admin' });
    await reportService.generateManualReport({ from, to, generatedBy: 'admin' });

    const count = await Report.countDocuments({ kind: 'MANUAL' });
    expect(count).toBe(2);
  });

  test('rejects missing from/to', async () => {
    await expect(reportService.generateManualReport({})).rejects.toThrow(ValidationError);
  });

  test('rejects to <= from', async () => {
    await expect(
      reportService.generateManualReport({
        from: new Date(),
        to: new Date(Date.now() - DAY),
      })
    ).rejects.toThrow(ValidationError);
  });

  test('embeds top hosts and attendees', async () => {
    await makeUser('mh4');
    await makeUser('ma1');
    await makeUser('ma2');
    await makeApprovedEvent('mh4', ['ma1', 'ma2']);

    const report = await reportService.generateManualReport({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      generatedBy: 'admin',
    });

    const titles = report.renderedPayload.embeds[0].fields.map((f) => f.name);
    expect(titles.some((t) => t.includes('Top Hosts'))).toBe(true);
    expect(titles.some((t) => t.includes('Top Attendees'))).toBe(true);
  });
});

// ===========================================================================
describe('report.service — reads', () => {
  test('getReportById returns the doc, throws for unknown', async () => {
    await makeUser('rh1');
    const report = await reportService.generateWeeklyReport();
    const fetched = await reportService.getReportById(report._id);
    expect(String(fetched._id)).toBe(String(report._id));

    await expect(reportService.getReportById('000000000000000000000000')).rejects.toThrow(NotFoundError);
  });

  test('listReports filters by kind and paginates', async () => {
    await makeUser('lh1');
    await reportService.generateWeeklyReport();
    await reportService.generateMonthlyReport();

    const weekly = await reportService.listReports({ kind: 'WEEKLY' });
    expect(weekly.total).toBe(1);
    const all = await reportService.listReports();
    expect(all.total).toBe(2);
  });

  test('getLatestReport returns the most recent by kind', async () => {
    await makeUser('gh1');
    await reportService.generateWeeklyReport();
    const latest = await reportService.getLatestReport('WEEKLY');
    expect(latest).not.toBeNull();
    expect(latest.kind).toBe('WEEKLY');
  });
});

// ===========================================================================
describe('report.service — renderDiscordEmbed is pure', () => {
  test('renderDiscordEmbed does not touch the DB', async () => {
    const fakeReport = {
      kind: 'WEEKLY',
      reportKey: '2026-W41',
      periodStart: new Date('2026-10-05T00:00:00Z'),
      periodEnd: new Date('2026-10-12T00:00:00Z'),
      generatedAt: new Date('2026-10-12T16:30:00Z'),
      generatedBy: 'system',
      summary: {
        totalEvents: 5,
        totalAttendance: 20,
        newStrikes: 2,
        recoveredStrikes: 1,
        pendingRemovals: 1,
        activeLeaves: 0,
        activeNotices: 0,
        quotaMet: 3,
        quotaMissed: 2,
      },
      eventsByType: [{ typeKey: 'patrol', count: 3 }, { typeKey: 'raid', count: 2 }],
      topHosts: [{ discordId: 'h1', count: 3 }],
      topAttendees: [{ discordId: 'a1', count: 5 }],
      quota: { staffCompleted: 2, staffMissed: 1, lowRankCompleted: 1, lowRankMissed: 1 },
      syncSummary: { syncCount: 1, membersFetched: 100, rankChanges: 3, membersRemoved: 0 },
    };

    const payload = reportService.renderDiscordEmbed(fakeReport);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].title).toContain('2026-W41');
    expect(payload.embeds[0].fields.length).toBeGreaterThan(3);
  });
});
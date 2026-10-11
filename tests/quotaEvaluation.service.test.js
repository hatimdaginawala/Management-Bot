import { describe, test, expect, beforeEach, beforeAll, jest } from '@jest/globals';
import { User, Role, RoleAssignment, Event, QuotaPolicy, QuotaPeriod, QuotaResult, Strike } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { seedEventTypes } from '../scripts/seedEventTypes.js';
import { isoWeekKey } from '../src/utils/isoWeek.js';

// ---- Mock strike.service BEFORE importing the evaluator ----
const mockStrikeService = {
  issueQuotaStrike: jest.fn(),
};
jest.unstable_mockModule('../src/services/strike.service.js', () => mockStrikeService);

let quotaPolicyService, quotaPeriodService, quotaEvaluationService, eventService;

beforeAll(async () => {
  quotaPolicyService = await import('../src/services/quotaPolicy.service.js');
  quotaPeriodService = await import('../src/services/quotaPeriod.service.js');
  quotaEvaluationService = await import('../src/services/quotaEvaluation.service.js');
  eventService = await import('../src/services/event.service.js');
});

async function makeUser(discordId, category) {
  return User.create({
    discordId,
    status: 'ACTIVE',
    quota: { exempt: false, exemptUntil: null, exemptReason: null, category },
  });
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await seedEventTypes();
  await QuotaPolicy.deleteMany({});
  await QuotaPeriod.deleteMany({});
  await QuotaResult.deleteMany({});
  await Strike.deleteMany({});
  await Event.deleteMany({});
  mockStrikeService.issueQuotaStrike.mockReset();
});

describe('quotaEvaluation.service — evaluatePeriod', () => {
  test('MET: user hosted quota with required events', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 2 });
    const period = await quotaPeriodService.getOrCreateCurrentPeriod();

    const host = await makeUser('host1', 'STAFF');

    // Create 2 approved events for this host within the period.
    for (let i = 0; i < 2; i++) {
      const attendee = await makeUser(`att${i}`, 'NONE');
      const ev = await Event.create({
        host: { userId: host._id, discordId: 'host1' },
        eventType: (await import('../src/models/index.js')).EventType.hydrate({
          _id: new (await import('mongoose')).default.Types.ObjectId(),
          key: 'patrol',
          name: 'Patrol',
        })._id,
        eventTypeKey: 'patrol',
        attendeeEntries: [],
        proofUrl: 'https://example.com/p.png',
        status: 'APPROVED',
        createdBy: 'host1',
        cooldownAnchor: new Date(period.startAt.getTime() + 60_000 + i * 60_000),
      });
    }

    const result = await quotaEvaluationService.evaluatePeriod(period.periodKey);
    expect(result.status).toBe('EVALUATED');
    expect(result.evaluated).toBe(1);

    const qr = await QuotaResult.findOne({ user: host._id });
    expect(qr.status).toBe('MET');
    expect(qr.actual).toBe(2);
    expect(mockStrikeService.issueQuotaStrike).not.toHaveBeenCalled();
  });

  test('MISSED: user did not hit quota → strike issued', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const period = await quotaPeriodService.getOrCreateCurrentPeriod();

    await makeUser('host2', 'STAFF');
    mockStrikeService.issueQuotaStrike.mockResolvedValue({ created: true });

    const result = await quotaEvaluationService.evaluatePeriod(period.periodKey);
    expect(result.strikesIssued).toBe(1);
    expect(mockStrikeService.issueQuotaStrike).toHaveBeenCalledTimes(1);

    const qr = await QuotaResult.findOne({ discordId: 'host2' });
    expect(qr.status).toBe('MISSED');
    expect(qr.strikeIssued).toBe(true);
  });

  test('idempotent: re-running yields no duplicate strike', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const period = await quotaPeriodService.getOrCreateCurrentPeriod();
    await makeUser('host3', 'STAFF');
    mockStrikeService.issueQuotaStrike.mockResolvedValue({ created: true });

    await quotaEvaluationService.evaluatePeriod(period.periodKey);
    const second = await quotaEvaluationService.evaluatePeriod(period.periodKey);

    // Second call should see the period is no longer OPEN.
    expect(second.status).toBe('ALREADY_CLOSED');
    expect(mockStrikeService.issueQuotaStrike).toHaveBeenCalledTimes(1);
  });

  test('EXEMPT via leave', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const period = await quotaPeriodService.getOrCreateCurrentPeriod();
    const user = await makeUser('host4', 'STAFF');

    const { Leave } = await import('../src/models/index.js');
    await Leave.create({
      user: user._id,
      discordId: 'host4',
      startAt: new Date(period.startAt.getTime() + 86_400_000),
      endAt: new Date(period.endAt.getTime() - 86_400_000),
      reason: 'vacation',
      status: 'APPROVED',
      reviewedBy: 'admin',
      reviewedAt: new Date(),
    });

    const result = await quotaEvaluationService.evaluatePeriod(period.periodKey);
    expect(result.strikesIssued).toBe(0);

    const qr = await QuotaResult.findOne({ user: user._id });
    expect(qr.status).toBe('EXEMPT');
    expect(qr.exemptReason).toBe('LEAVE');
  });

  test('EXEMPT via manual exemption', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const period = await quotaPeriodService.getOrCreateCurrentPeriod();

    const user = await User.create({
      discordId: 'host5',
      status: 'ACTIVE',
      quota: { exempt: true, exemptUntil: null, exemptReason: 'sick', category: 'STAFF' },
    });

    await quotaEvaluationService.evaluatePeriod(period.periodKey);
    const qr = await QuotaResult.findOne({ user: user._id });
    expect(qr.status).toBe('EXEMPT');
    expect(qr.exemptReason).toBe('MANUAL');
  });

  test('NONE category users are not evaluated', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const period = await quotaPeriodService.getOrCreateCurrentPeriod();
    await makeUser('cmd1', 'NONE');

    const result = await quotaEvaluationService.evaluatePeriod(period.periodKey);
    expect(result.evaluated).toBe(0);
    expect(await QuotaResult.countDocuments({})).toBe(0);
  });

  test('next period is opened after evaluation', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const period = await quotaPeriodService.getOrCreateCurrentPeriod();
    await quotaEvaluationService.evaluatePeriod(period.periodKey);

    const open = await QuotaPeriod.findOne({ status: 'OPEN' });
    expect(open).not.toBeNull();
    expect(open.periodKey).not.toBe(period.periodKey);
  });

  test('dryRun does not call strike service', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const period = await quotaPeriodService.getOrCreateCurrentPeriod();
    await makeUser('host9', 'STAFF');

    await quotaEvaluationService.evaluatePeriod(period.periodKey, { dryRun: true });
    expect(mockStrikeService.issueQuotaStrike).not.toHaveBeenCalled();
  });
});
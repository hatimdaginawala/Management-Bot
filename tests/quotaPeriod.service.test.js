import { describe, test, expect, beforeEach } from '@jest/globals';
import * as quotaPolicyService from '../src/services/quotaPolicy.service.js';
import * as quotaPeriodService from '../src/services/quotaPeriod.service.js';
import { QuotaPolicy, QuotaPeriod } from '../src/models/index.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { ConflictError, NotFoundError } from '../src/utils/errors.js';

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await QuotaPolicy.deleteMany({});
  await QuotaPeriod.deleteMany({});
});

describe('quotaPeriod.service', () => {
  test('getOrCreateCurrentPeriod opens the current week', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    await quotaPolicyService.setPolicy('admin', { category: 'LOW_RANK', amount: 3 });

    const period = await quotaPeriodService.getOrCreateCurrentPeriod();
    expect(period.status).toBe('OPEN');
    expect(period.policies).toHaveLength(2);
    expect(period.startAt).toBeInstanceOf(Date);
    expect(period.endAt).toBeInstanceOf(Date);
  });

  test('getOrCreateCurrentPeriod is idempotent', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const p1 = await quotaPeriodService.getOrCreateCurrentPeriod();
    const p2 = await quotaPeriodService.getOrCreateCurrentPeriod();
    expect(String(p1._id)).toBe(String(p2._id));
  });

  test('policy snapshot is stable after policy change', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const p = await quotaPeriodService.getOrCreateCurrentPeriod();

    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 7 });
    const reloaded = await quotaPeriodService.getPeriodByKey(p.periodKey);
    const staffSnap = reloaded.policies.find((x) => x.category === 'STAFF');
    expect(staffSnap.amount).toBe(5); // snapshot preserved
  });

  test('acquireClosingLock transitions OPEN → CLOSING once', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const p = await quotaPeriodService.getOrCreateCurrentPeriod();

    const first = await quotaPeriodService.acquireClosingLock(p.periodKey);
    expect(first.status).toBe('CLOSING');

    const second = await quotaPeriodService.acquireClosingLock(p.periodKey);
    expect(second).toBeNull();
  });

  test('finalizePeriod transitions CLOSING → CLOSED', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const p = await quotaPeriodService.getOrCreateCurrentPeriod();
    await quotaPeriodService.acquireClosingLock(p.periodKey);

    const closed = await quotaPeriodService.finalizePeriod(p.periodKey, {
      evaluatedCount: 5,
      strikesIssuedCount: 1,
      recoveriesAppliedCount: 2,
    });
    expect(closed.status).toBe('CLOSED');
    expect(closed.evaluatedCount).toBe(5);
  });

  test('finalizePeriod throws if not CLOSING', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const p = await quotaPeriodService.getOrCreateCurrentPeriod();
    await expect(quotaPeriodService.finalizePeriod(p.periodKey)).rejects.toThrow(ConflictError);
  });

  test('openNextPeriod creates the following week', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const p = await quotaPeriodService.getOrCreateCurrentPeriod();
    await quotaPeriodService.acquireClosingLock(p.periodKey);
    await quotaPeriodService.finalizePeriod(p.periodKey);

    const next = await quotaPeriodService.openNextPeriod(p.periodKey);
    expect(next.status).toBe('OPEN');
    expect(next.periodKey).not.toBe(p.periodKey);
  });

  test('getPeriodByKey throws for unknown key', async () => {
    await expect(
      quotaPeriodService.getPeriodByKey('2099-W01')
    ).rejects.toThrow(NotFoundError);
  });
});
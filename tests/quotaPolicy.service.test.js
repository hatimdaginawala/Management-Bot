import { describe, test, expect, beforeEach } from '@jest/globals';
import * as quotaPolicyService from '../src/services/quotaPolicy.service.js';
import { QuotaPolicy } from '../src/models/index.js';
import { ValidationError } from '../src/utils/errors.js';

beforeEach(async () => {
  await QuotaPolicy.deleteMany({});
});

describe('quotaPolicy.service', () => {
  test('setPolicy creates first policy for a category', async () => {
    const p = await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    expect(p.category).toBe('STAFF');
    expect(p.amount).toBe(5);
    expect(p.metric).toBe('HOSTED_EVENTS');
    expect(p.effectiveTo).toBeNull();
    expect(p.active).toBe(true);
  });

  test('setPolicy closes the previous open policy', async () => {
    const first = await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    const second = await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 7 });

    const reloadedFirst = await QuotaPolicy.findById(first._id).lean();
    expect(reloadedFirst.effectiveTo).not.toBeNull();
    expect(reloadedFirst.active).toBe(false);

    expect(second.amount).toBe(7);
    expect(second.effectiveTo).toBeNull();

    const active = await quotaPolicyService.getActivePolicyForCategory('STAFF');
    expect(active.amount).toBe(7);
  });

  test('rejects invalid amount', async () => {
    await expect(
      quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: -1 })
    ).rejects.toThrow(ValidationError);
  });

  test('rejects invalid category', async () => {
    await expect(
      quotaPolicyService.setPolicy('admin', { category: 'BOGUS', amount: 5 })
    ).rejects.toThrow(ValidationError);
  });

  test('rejects invalid recoveryMultiplier', async () => {
    await expect(
      quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5, recoveryMultiplier: 0 })
    ).rejects.toThrow(ValidationError);
  });

  test('STAFF and LOW_RANK can have separate policies simultaneously', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    await quotaPolicyService.setPolicy('admin', { category: 'LOW_RANK', amount: 3 });

    const s = await quotaPolicyService.getActivePolicyForCategory('STAFF');
    const l = await quotaPolicyService.getActivePolicyForCategory('LOW_RANK');
    expect(s.amount).toBe(5);
    expect(l.amount).toBe(3);
  });

  test('listPolicies filters by category', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    await quotaPolicyService.setPolicy('admin', { category: 'LOW_RANK', amount: 3 });
    const staff = await quotaPolicyService.listPolicies({ category: 'STAFF' });
    expect(staff).toHaveLength(1);
  });
});
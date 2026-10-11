import { describe, test, expect, beforeEach } from '@jest/globals';
import { User, QuotaPolicy, Role, RoleAssignment } from '../src/models/index.js';
import * as quotaPolicyService from '../src/services/quotaPolicy.service.js';
import * as userService from '../src/services/user.service.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';

async function makeUser(discordId) {
  return User.create({
    discordId,
    status: 'ACTIVE',
    quota: { exempt: false, exemptUntil: null, exemptReason: null, category: 'NONE' },
  });
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await QuotaPolicy.deleteMany({});
});

// ===========================================================================
describe('quota commands — policy set', () => {
  test('setPolicy creates a STAFF policy', async () => {
    const p = await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    expect(p.category).toBe('STAFF');
    expect(p.amount).toBe(5);
    expect(p.metric).toBe('HOSTED_EVENTS');
  });

  test('setPolicy creates a LOW_RANK policy with the right metric', async () => {
    const p = await quotaPolicyService.setPolicy('admin', { category: 'LOW_RANK', amount: 3 });
    expect(p.category).toBe('LOW_RANK');
    expect(p.metric).toBe('ATTENDED_EVENTS');
  });

  test('setPolicy rejects invalid category', async () => {
    await expect(
      quotaPolicyService.setPolicy('admin', { category: 'BOGUS', amount: 5 })
    ).rejects.toThrow();
  });

  test('setPolicy rejects negative amount', async () => {
    await expect(
      quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: -1 })
    ).rejects.toThrow();
  });

  test('setPolicy rejects recoveryMultiplier below 1', async () => {
    await expect(
      quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5, recoveryMultiplier: 0 })
    ).rejects.toThrow();
  });

  test('setting a new policy closes the old one', async () => {
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 5 });
    await quotaPolicyService.setPolicy('admin', { category: 'STAFF', amount: 7 });
    const active = await quotaPolicyService.getActivePolicyForCategory('STAFF');
    expect(active.amount).toBe(7);
    const all = await quotaPolicyService.listPolicies({ category: 'STAFF' });
    expect(all).toHaveLength(2);
    expect(all.filter((p) => p.active)).toHaveLength(1);
  });
});

// ===========================================================================
describe('quota commands — exemption', () => {
  test('setQuotaExemption sets flag and reason', async () => {
    await makeUser('u1');
    const user = await userService.setQuotaExemption('admin', 'u1', { reason: 'medical' });
    expect(user.quota.exempt).toBe(true);
    expect(user.quota.exemptReason).toBe('medical');
  });

  test('setQuotaExemption requires a reason', async () => {
    await makeUser('u2');
    await expect(
      userService.setQuotaExemption('admin', 'u2', { reason: '' })
    ).rejects.toThrow();
  });

  test('clearQuotaExemption resets', async () => {
    await makeUser('u3');
    await userService.setQuotaExemption('admin', 'u3', { reason: 'medical' });
    const user = await userService.clearQuotaExemption('admin', 'u3');
    expect(user.quota.exempt).toBe(false);
    expect(user.quota.exemptReason).toBeNull();
  });

  test('clearQuotaExemption on non-exempt user is a no-op', async () => {
    await makeUser('u4');
    const user = await userService.clearQuotaExemption('admin', 'u4');
    expect(user.quota.exempt).toBe(false);
  });
});
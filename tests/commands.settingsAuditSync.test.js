import { describe, test, expect, beforeEach } from '@jest/globals';
import { Settings, AuditLog, SyncLog } from '../src/models/index.js';
import * as settingsService from '../src/services/settings.service.js';
import * as auditService from '../src/services/audit.service.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await Settings.deleteMany({});
  await seedSettings();
});

// ===========================================================================
describe('settings commands — service layer', () => {
  test('getSettings returns singleton', async () => {
    const doc = await settingsService.getSettings();
    expect(doc.key).toBe('global');
  });

  test('describeSettings lists all paths', async () => {
    const { rows } = await settingsService.describeSettings();
    expect(rows.length).toBeGreaterThan(15);
  });

  test('setSetting with valid value', async () => {
    const v = await settingsService.setSetting('admin', 'events.cooldownMinutes', 10);
    expect(v).toBe(10);
  });

  test('setSetting with invalid value throws', async () => {
    await expect(
      settingsService.setSetting('admin', 'events.cooldownMinutes', -1)
    ).rejects.toThrow();
  });

  test('resetSetting restores default', async () => {
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 10);
    const v = await settingsService.resetSetting('admin', 'events.cooldownMinutes');
    expect(v).toBe(5);
  });
});

// ===========================================================================
describe('audit commands — service layer', () => {
  test('queryLogs returns empty for fresh DB', async () => {
    const result = await auditService.queryLogs({});
    expect(result.total).toBe(0);
  });

  test('queryLogs returns entries after an audit write', async () => {
    const { audit } = await import('../src/utils/audit.js');
    await audit({
      actorId: 'test-actor',
      action: 'test.action',
      category: 'SETTINGS',
      targetType: 'Settings',
    });
    const result = await auditService.queryLogs({ action: 'test.action' });
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  test('listCategories groups by category', async () => {
    const { audit } = await import('../src/utils/audit.js');
    await audit({
      actorId: 'x',
      action: 'test.cat',
      category: 'ROLE',
      targetType: 'Role',
    });
    const cats = await auditService.listCategories();
    expect(cats.some((c) => c.category === 'ROLE')).toBe(true);
  });

  test('summarize returns totals', async () => {
    const { audit } = await import('../src/utils/audit.js');
    await audit({
      actorId: 'x',
      action: 'test.sum',
      category: 'USER',
      targetType: 'User',
    });
    const summary = await auditService.summarize();
    expect(summary.total).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
describe('sync commands — service layer', () => {
  test('SyncLog entries are queryable', async () => {
    await SyncLog.create({
      type: 'ROBLOX_GROUP_SYNC',
      triggeredBy: 'test',
      startedAt: new Date(Date.now() - 1000),
      completedAt: new Date(),
      status: 'SUCCESS',
      membersFetched: 10,
      membersCreated: 2,
      membersUpdated: 5,
      rankChanges: 1,
      membersRemoved: 0,
    });
    const latest = await SyncLog.findOne({ type: 'ROBLOX_GROUP_SYNC' })
      .sort({ startedAt: -1 })
      .lean();
    expect(latest.status).toBe('SUCCESS');
    expect(latest.membersFetched).toBe(10);
  });
});
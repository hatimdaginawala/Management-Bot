import { describe, test, expect, beforeEach } from '@jest/globals';
import * as settingsService from '../src/services/settings.service.js';
import { Settings, AuditLog } from '../src/models/index.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { ValidationError, NotFoundError } from '../src/utils/errors.js';

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await Settings.deleteMany({});
  // NOTE: AuditLog is append-only by design. Its deleteMany is blocked
  // at the model layer. The global tests/setup.js wipes every
  // collection between tests using the raw MongoDB driver, which
  // bypasses Mongoose middleware — so no explicit cleanup is needed
  // (or possible) here.
  await seedSettings();
});

// ===========================================================================
describe('settings.service — reads', () => {
  test('getSettings returns the singleton', async () => {
    const s = await settingsService.getSettings();
    expect(s.key).toBe('global');
    expect(s.events.approvalRequired).toBe(true);
    expect(s.events.cooldownMinutes).toBe(5);
  });

  test('getSetting reads a dotted path', async () => {
    const v = await settingsService.getSetting('events.approvalRequired');
    expect(v).toBe(true);
  });

  test('getSetting returns undefined for missing paths', async () => {
    const v = await settingsService.getSetting('nope.nothing.here');
    expect(v).toBeUndefined();
  });

  test('describeSettings lists all whitelisted paths', async () => {
    const { rows } = await settingsService.describeSettings();
    expect(rows.length).toBeGreaterThan(15);
    const eventsPath = rows.find((r) => r.path === 'events.approvalRequired');
    expect(eventsPath.value).toBe(true);
    expect(eventsPath.description).toContain('approval');
  });
});

// ===========================================================================
describe('settings.service — setSetting', () => {
  test('writes a whitelisted boolean', async () => {
    const v = await settingsService.setSetting('admin', 'events.approvalRequired', false, {
      reason: 'change policy',
    });
    expect(v).toBe(false);

    const reloaded = await settingsService.getSetting('events.approvalRequired');
    expect(reloaded).toBe(false);
  });

  test('writes a whitelisted integer', async () => {
    const v = await settingsService.setSetting('admin', 'strikes.removalThreshold', 5);
    expect(v).toBe(5);
  });

  test('writes a channel ID', async () => {
    const v = await settingsService.setSetting('admin', 'channels.reportChannelId', '1234567890123456789');
    expect(v).toBe('1234567890123456789');
  });

  test('accepts null for channel ID (unset)', async () => {
    const v = await settingsService.setSetting('admin', 'channels.reportChannelId', null);
    expect(v).toBeNull();
  });

  test('rejects non-whitelisted path', async () => {
    await expect(
      settingsService.setSetting('admin', '_id', '123')
    ).rejects.toThrow(ValidationError);
    await expect(
      settingsService.setSetting('admin', 'nope.nothing', 'x')
    ).rejects.toThrow(ValidationError);
  });

  test('rejects invalid boolean', async () => {
    await expect(
      settingsService.setSetting('admin', 'events.approvalRequired', 'yes')
    ).rejects.toThrow(ValidationError);
  });

  test('rejects invalid integer', async () => {
    await expect(
      settingsService.setSetting('admin', 'strikes.removalThreshold', -1)
    ).rejects.toThrow(ValidationError);
    await expect(
      settingsService.setSetting('admin', 'strikes.removalThreshold', 3.5)
    ).rejects.toThrow(ValidationError);
  });

  test('rejects out-of-range weekStartsOn', async () => {
    await expect(
      settingsService.setSetting('admin', 'quotas.weekStartsOn', 7)
    ).rejects.toThrow(ValidationError);
  });

  test('rejects invalid timezone', async () => {
    await expect(
      settingsService.setSetting('admin', 'reports.displayTimezone', 'Not/A/Zone')
    ).rejects.toThrow(ValidationError);
  });

  test('accepts valid timezone', async () => {
    const v = await settingsService.setSetting('admin', 'reports.displayTimezone', 'Europe/London');
    expect(v).toBe('Europe/London');
  });

  test('accepts valid cron override', async () => {
    const v = await settingsService.setSetting('admin', 'reports.cronOverride', '0 22 * * 0');
    expect(v).toBe('0 22 * * 0');
  });

  test('rejects malformed cron', async () => {
    await expect(
      settingsService.setSetting('admin', 'reports.cronOverride', 'not cron')
    ).rejects.toThrow(ValidationError);
  });

  test('writes audit entry with before/after', async () => {
    const before = await AuditLog.countDocuments({ action: 'settings.changed' });
    await settingsService.setSetting('admin', 'events.approvalRequired', false, { reason: 'test' });
    const after = await AuditLog.countDocuments({ action: 'settings.changed' });
    expect(after - before).toBe(1);

    const latest = await AuditLog.findOne({ action: 'settings.changed' })
      .sort({ createdAt: -1 })
      .lean();
    expect(latest.before).toEqual({ path: 'events.approvalRequired', value: true });
    expect(latest.after).toEqual({ path: 'events.approvalRequired', value: false });
    expect(latest.reason).toBe('test');
    expect(latest.actorId).toBe('admin');
  });

  test('updates lastUpdatedBy', async () => {
    await settingsService.setSetting('someone', 'events.approvalRequired', false);
    const s = await settingsService.getSettings();
    expect(s.lastUpdatedBy).toBe('someone');
  });
});

// ===========================================================================
describe('settings.service — setSettings (bulk)', () => {
  test('writes multiple paths in one call', async () => {
    await settingsService.setSettings('admin', {
      'events.approvalRequired': false,
      'events.cooldownMinutes': 10,
      'strikes.removalThreshold': 5,
    });

    const s = await settingsService.getSettings();
    expect(s.events.approvalRequired).toBe(false);
    expect(s.events.cooldownMinutes).toBe(10);
    expect(s.strikes.removalThreshold).toBe(5);
  });

  test('is atomic — invalid path prevents all writes', async () => {
    await expect(
      settingsService.setSettings('admin', {
        'events.approvalRequired': false,
        'nope.nothing': 'x',
      })
    ).rejects.toThrow(ValidationError);

    const s = await settingsService.getSettings();
    expect(s.events.approvalRequired).toBe(true);
  });

  test('is atomic — invalid value prevents all writes', async () => {
    await expect(
      settingsService.setSettings('admin', {
        'events.approvalRequired': false,
        'events.cooldownMinutes': -5,
      })
    ).rejects.toThrow(ValidationError);

    const s = await settingsService.getSettings();
    expect(s.events.approvalRequired).toBe(true);
    expect(s.events.cooldownMinutes).toBe(5);
  });

  test('rejects empty patch', async () => {
    await expect(settingsService.setSettings('admin', {})).rejects.toThrow(ValidationError);
  });

  test('rejects array patch', async () => {
    await expect(settingsService.setSettings('admin', [1, 2])).rejects.toThrow(ValidationError);
  });

  test('writes one audit entry for the whole patch', async () => {
    const before = await AuditLog.countDocuments({ action: 'settings.bulk_changed' });
    await settingsService.setSettings('admin', {
      'events.approvalRequired': false,
      'events.cooldownMinutes': 10,
    });
    const after = await AuditLog.countDocuments({ action: 'settings.bulk_changed' });
    expect(after - before).toBe(1);

    const latest = await AuditLog.findOne({ action: 'settings.bulk_changed' })
      .sort({ createdAt: -1 })
      .lean();
    expect(Object.keys(latest.after).length).toBe(2);
  });
});

// ===========================================================================
describe('settings.service — resetSetting', () => {
  test('resets a path to seed default', async () => {
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 30);
    await settingsService.resetSetting('admin', 'events.cooldownMinutes');
    const v = await settingsService.getSetting('events.cooldownMinutes');
    expect(v).toBe(5);
  });

  test('rejects unknown path', async () => {
    await expect(
      settingsService.resetSetting('admin', 'nope.nothing')
    ).rejects.toThrow(ValidationError);
  });
});
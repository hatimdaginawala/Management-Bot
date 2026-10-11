import { describe, test, expect, beforeEach } from '@jest/globals';
import * as auditService from '../src/services/audit.service.js';
import * as roleService from '../src/services/role.service.js';
import * as settingsService from '../src/services/settings.service.js';
import { AuditLog, User, Role, RoleAssignment, Settings } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { ValidationError, NotFoundError } from '../src/utils/errors.js';

async function makeActor(roleKey, discordId) {
  const user = await User.create({ discordId, status: 'ACTIVE' });
  const role = await Role.findOne({ key: roleKey });
  await RoleAssignment.create({
    user: user._id,
    discordId,
    role: role._id,
    roleKey: role.key,
    assignedBy: 'test',
    active: true,
  });
  return user;
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  // AuditLog cannot be wiped through the model (append-only).
  // The global setup's raw-driver wipe handles it between tests.
});

// ===========================================================================
describe('audit.service — queryLogs', () => {
  test('empty collection returns zero items', async () => {
    const result = await auditService.queryLogs({});
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.page).toBe(1);
  });

  test('returns newest-first ordered items', async () => {
    // Generate two distinguishable audit entries via role creation.
    const admin = await makeActor('super_admin', 'admin-1');
    await roleService.createRole(admin.discordId, {
      key: 'test_one',
      name: 'Test One',
      priority: 5,
      permissions: [],
    });
    // Tiny delay so createdAt differs at millisecond resolution.
    await new Promise((r) => setTimeout(r, 5));
    await roleService.createRole(admin.discordId, {
      key: 'test_two',
      name: 'Test Two',
      priority: 5,
      permissions: [],
    });

    const result = await auditService.queryLogs({ action: 'role.created' });
    expect(result.total).toBeGreaterThanOrEqual(2);
    const [first, second] = result.items;
    expect(new Date(first.createdAt).getTime())
      .toBeGreaterThanOrEqual(new Date(second.createdAt).getTime());
  });

  test('filters by actorId', async () => {
    await settingsService.setSetting('actor_a', 'events.cooldownMinutes', 10);
    await settingsService.setSetting('actor_b', 'events.cooldownMinutes', 20);

    const a = await auditService.queryLogs({ actorId: 'actor_a' });
    expect(a.total).toBe(1);
    expect(a.items[0].actorId).toBe('actor_a');
  });

  test('filters by category', async () => {
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 10);
    const s = await auditService.queryLogs({ category: 'SETTINGS' });
    expect(s.total).toBeGreaterThanOrEqual(1);
    expect(s.items.every((e) => e.category === 'SETTINGS')).toBe(true);
  });

  test('rejects invalid category', async () => {
    await expect(
      auditService.queryLogs({ category: 'NOT_A_CATEGORY' })
    ).rejects.toThrow(ValidationError);
  });

  test('filters by date range', async () => {
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 10);

    const farFuture = new Date(Date.now() + 100 * 86_400_000);
    const past = new Date(Date.now() - 100 * 86_400_000);

    const empty = await auditService.queryLogs({ from: farFuture });
    expect(empty.total).toBe(0);

    const all = await auditService.queryLogs({ from: past });
    expect(all.total).toBeGreaterThanOrEqual(1);
  });

  test('rejects invalid date', async () => {
    await expect(
      auditService.queryLogs({ from: 'not a date' })
    ).rejects.toThrow(ValidationError);
  });

  test('pagination works', async () => {
    // Generate 3 entries.
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 10);
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 11);
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 12);

    const p1 = await auditService.queryLogs({ actorId: 'admin', page: 1, pageSize: 2 });
    const p2 = await auditService.queryLogs({ actorId: 'admin', page: 2, pageSize: 2 });
    expect(p1.total).toBe(3);
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(1);
    expect(p1.totalPages).toBe(2);
  });

  test('pageSize is clamped to 100', async () => {
    const result = await auditService.queryLogs({ pageSize: 9999 });
    expect(result.pageSize).toBe(100);
  });
});

// ===========================================================================
describe('audit.service — getEntry', () => {
  test('returns the entry by id', async () => {
    const admin = await makeActor('super_admin', 'admin-2');
    await roleService.createRole(admin.discordId, {
      key: 'test_lookup',
      name: 'Test Lookup',
      priority: 5,
      permissions: [],
    });

    const list = await auditService.queryLogs({ action: 'role.created' });
    const target = list.items[0];
    const entry = await auditService.getEntry(target._id);
    expect(String(entry._id)).toBe(String(target._id));
  });

  test('throws NotFoundError for unknown id', async () => {
    await expect(
      auditService.getEntry('000000000000000000000000')
    ).rejects.toThrow(NotFoundError);
  });

  test('throws ValidationError for missing id', async () => {
    await expect(auditService.getEntry()).rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
describe('audit.service — listCategories / listActions', () => {
  test('listCategories groups by category', async () => {
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 10);
    const admin = await makeActor('super_admin', 'admin-3');
    await roleService.createRole(admin.discordId, {
      key: 'test_cat',
      name: 'Test Cat',
      priority: 5,
      permissions: [],
    });

    const cats = await auditService.listCategories();
    const names = cats.map((c) => c.category);
    expect(names).toContain('SETTINGS');
    expect(names).toContain('ROLE');
  });

  test('listActions filters by category', async () => {
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 10);
    const admin = await makeActor('super_admin', 'admin-4');
    await roleService.createRole(admin.discordId, {
      key: 'test_act',
      name: 'Test Act',
      priority: 5,
      permissions: [],
    });

    const actions = await auditService.listActions({ category: 'ROLE' });
    expect(actions.some((a) => a.action === 'role.created')).toBe(true);
    expect(actions.some((a) => a.action === 'settings.changed')).toBe(false);
  });

  test('listActions rejects invalid category', async () => {
    await expect(
      auditService.listActions({ category: 'BOGUS' })
    ).rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
describe('audit.service — historyForTarget', () => {
  test('returns entries targeting a specific role', async () => {
    const admin = await makeActor('super_admin', 'admin-5');
    const role = await roleService.createRole(admin.discordId, {
      key: 'test_target',
      name: 'Test Target',
      priority: 5,
      permissions: [],
    });

    const result = await auditService.historyForTarget({
      targetType: 'Role',
      targetId: String(role._id),
    });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items.every((e) => e.targetId === String(role._id))).toBe(true);
  });

  test('requires targetType and targetId', async () => {
    await expect(
      auditService.historyForTarget({ targetId: 'x' })
    ).rejects.toThrow(ValidationError);
    await expect(
      auditService.historyForTarget({ targetType: 'Role' })
    ).rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
describe('audit.service — activityByActor', () => {
  test('returns entries for a specific actor', async () => {
    await settingsService.setSetting('actor_x', 'events.cooldownMinutes', 10);
    await settingsService.setSetting('actor_y', 'events.cooldownMinutes', 20);

    const result = await auditService.activityByActor({ actorId: 'actor_x' });
    expect(result.total).toBe(1);
    expect(result.items[0].actorId).toBe('actor_x');
  });

  test('requires actorId', async () => {
    await expect(auditService.activityByActor({})).rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
describe('audit.service — summarize', () => {
  test('returns totals grouped by category/action/actor', async () => {
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 10);
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 20);

    const summary = await auditService.summarize();
    expect(summary.total).toBeGreaterThanOrEqual(2);
    expect(summary.byCategory.some((r) => r.category === 'SETTINGS')).toBe(true);
    expect(summary.byAction.some((r) => r.action === 'settings.changed')).toBe(true);
    expect(summary.byActor.some((r) => r.actorId === 'admin')).toBe(true);
  });

  test('respects date range', async () => {
    await settingsService.setSetting('admin', 'events.cooldownMinutes', 10);

    const farFuture = new Date(Date.now() + 100 * 86_400_000);
    const summary = await auditService.summarize({ from: farFuture });
    expect(summary.total).toBe(0);
  });
});
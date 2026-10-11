import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  getEffectivePermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  canManageRole,
  getHighestPriority,
} from '../src/services/permission.service.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { Role, RoleAssignment, User } from '../src/models/index.js';
import { ALL_PERMISSION_KEYS } from '../src/constants/permissions.js';

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

async function assign(user, roleKey) {
  const role = await Role.findOne({ key: roleKey });
  await RoleAssignment.create({
    user: user._id,
    discordId: user.discordId,
    role: role._id,
    roleKey: role.key,
    assignedBy: 'test',
    active: true,
  });
  return role;
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
});

describe('permission.service', () => {
  test('super_admin has every permission (including wildcard)', async () => {
    const user = await makeUser('u1');
    await assign(user, 'super_admin');
    const perms = await getEffectivePermissions(user._id);
    for (const k of ALL_PERMISSION_KEYS) expect(perms.has(k)).toBe(true);
  });

  test('staff has events.view, not events.approve', async () => {
    const user = await makeUser('u2');
    await assign(user, 'staff');
    expect(await hasPermission(user._id, 'events.view')).toBe(true);
    expect(await hasPermission(user._id, 'events.approve')).toBe(false);
  });

  test('high_command inherits events.* wildcard (approve + reject)', async () => {
    const user = await makeUser('u3');
    await assign(user, 'high_command');
    expect(await hasPermission(user._id, 'events.approve')).toBe(true);
    expect(await hasPermission(user._id, 'events.reject')).toBe(true);
  });

  test('multiple roles union permissions', async () => {
    const user = await makeUser('u4');
    await assign(user, 'staff');
    // Create a custom role to prove union.
    const custom = await Role.create({
      key: 'event_manager',
      name: 'Event Manager',
      permissions: ['events.approve'],
      priority: 50,
      quotaCategory: 'NONE',
      kind: 'CUSTOM',
    });
    await RoleAssignment.create({
      user: user._id,
      discordId: user.discordId,
      role: custom._id,
      roleKey: custom.key,
      assignedBy: 'test',
      active: true,
    });
    expect(await hasPermission(user._id, 'events.view')).toBe(true);   // from staff
    expect(await hasPermission(user._id, 'events.approve')).toBe(true); // from custom
  });

  test('hasAnyPermission and hasAllPermissions', async () => {
    const user = await makeUser('u5');
    await assign(user, 'staff');
    expect(await hasAnyPermission(user._id, ['events.approve', 'events.view'])).toBe(true);
    expect(await hasAllPermissions(user._id, ['events.view', 'events.create'])).toBe(true);
    expect(await hasAllPermissions(user._id, ['events.view', 'events.approve'])).toBe(false);
  });

  test('unknown permission string grants nothing', async () => {
    const role = await Role.create({
      key: 'broken',
      name: 'Broken',
      permissions: ['events.does_not_exist', 'nonsense'],
      priority: 5,
      kind: 'CUSTOM',
    });
    const user = await makeUser('u6');
    await RoleAssignment.create({
      user: user._id,
      discordId: user.discordId,
      role: role._id,
      roleKey: role.key,
      assignedBy: 'test',
      active: true,
    });
    const perms = await getEffectivePermissions(user._id);
    expect(perms.size).toBe(0);
  });

  test('canManageRole respects priority hierarchy', async () => {
    const supreme = await makeUser('supreme');
    await assign(supreme, 'supreme_command');

    const high = await makeUser('high');
    await assign(high, 'high_command');

    const hcRole = await Role.findOne({ key: 'high_command' });
    const scRole = await Role.findOne({ key: 'supreme_command' });

    // Supreme can manage High Command (100 > 80).
    expect(await canManageRole(supreme._id, hcRole)).toBe(true);
    // High cannot manage Supreme (80 < 100).
    expect(await canManageRole(high._id, scRole)).toBe(false);
    // High cannot manage another High (80 == 80).
    expect(await canManageRole(high._id, hcRole)).toBe(false);
  });

  test('super_admin can manage any role', async () => {
    const admin = await makeUser('admin');
    await assign(admin, 'super_admin');
    const scRole = await Role.findOne({ key: 'supreme_command' });
    expect(await canManageRole(admin._id, scRole)).toBe(true);
  });

  test('getHighestPriority returns the top role', async () => {
    const user = await makeUser('mix');
    await assign(user, 'staff');
    await assign(user, 'high_command');
    const { priority, role } = await getHighestPriority(user._id);
    expect(priority).toBe(80);
    expect(role.key).toBe('high_command');
  });
});
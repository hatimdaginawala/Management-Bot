import { describe, test, expect, beforeEach } from '@jest/globals';
import { User, Role, RoleAssignment, RemovalRequest } from '../src/models/index.js';
import * as roleService from '../src/services/role.service.js';
import * as userService from '../src/services/user.service.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';

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
  await Role.deleteMany({ key: { $nin: ['super_admin', 'supreme_command', 'high_command', 'staff', 'low_rank'] } });
  await RemovalRequest.deleteMany({});
});

// ===========================================================================
describe('role commands — service layer', () => {
  test('createRole with valid payload succeeds', async () => {
    const admin = await makeActor('super_admin', 'admin-1');
    const role = await roleService.createRole(admin.discordId, {
      key: 'event_manager',
      name: 'Event Manager',
      priority: 30,
      quotaCategory: 'NONE',
      permissions: [],
    });
    expect(role.key).toBe('event_manager');
    expect(role.priority).toBe(30);
  });

  test('createRole with priority >= actor priority fails', async () => {
    const high = await makeActor('high_command', 'high-1');
    await expect(
      roleService.createRole(high.discordId, {
        key: 'too_high',
        name: 'Too High',
        priority: 80,
        permissions: [],
      })
    ).rejects.toThrow();
  });

  test('assignRole assigns to user', async () => {
    const admin = await makeActor('super_admin', 'admin-2');
    await User.create({ discordId: 'target-1', status: 'ACTIVE' });
    const result = await roleService.assignRole(admin.discordId, 'target-1', 'staff');
    expect(result.assigned).toBe(true);
  });

  test('assignRole twice is idempotent', async () => {
    const admin = await makeActor('super_admin', 'admin-3');
    await User.create({ discordId: 'target-2', status: 'ACTIVE' });
    const first = await roleService.assignRole(admin.discordId, 'target-2', 'staff');
    const second = await roleService.assignRole(admin.discordId, 'target-2', 'staff');
    expect(first.assigned).toBe(true);
    expect(second.assigned).toBe(false);
  });

  test('removeRole is idempotent', async () => {
    const admin = await makeActor('super_admin', 'admin-4');
    await User.create({ discordId: 'target-3', status: 'ACTIVE' });
    await roleService.assignRole(admin.discordId, 'target-3', 'staff');
    const first = await roleService.removeRole(admin.discordId, 'target-3', 'staff');
    const second = await roleService.removeRole(admin.discordId, 'target-3', 'staff');
    expect(first.removed).toBe(true);
    expect(second.removed).toBe(false);
  });

  test('deleteRole with active assignments fails', async () => {
    const admin = await makeActor('super_admin', 'admin-5');
    await roleService.createRole(admin.discordId, {
      key: 'temp_role',
      name: 'Temp',
      priority: 5,
      permissions: [],
    });
    await User.create({ discordId: 'target-4', status: 'ACTIVE' });
    await roleService.assignRole(admin.discordId, 'target-4', 'temp_role');
    await expect(roleService.deleteRole(admin.discordId, 'temp_role')).rejects.toThrow();
  });
});

// ===========================================================================
describe('members commands — service layer', () => {
  test('listMembers filters by status', async () => {
    await User.create({ discordId: 'm1', status: 'ACTIVE' });
    await User.create({ discordId: 'm2', status: 'INACTIVE' });
    const active = await userService.listMembers({ status: 'ACTIVE' });
    const inactive = await userService.listMembers({ status: 'INACTIVE' });
    expect(active.total).toBeGreaterThanOrEqual(1);
    expect(inactive.total).toBeGreaterThanOrEqual(1);
  });

  test('listMembers search filter works', async () => {
    await User.create({ discordId: 'search-1', discordUsername: 'AlphaWolf', status: 'ACTIVE' });
    await User.create({ discordId: 'search-2', discordUsername: 'BravoBull', status: 'ACTIVE' });
    const result = await userService.listMembers({ status: 'ANY', search: 'alpha' });
    expect(result.total).toBe(1);
    expect(result.items[0].discordId).toBe('search-1');
  });

  test('pending-removal listing returns users with PENDING requests', async () => {
    const u = await User.create({ discordId: 'pending-1', status: 'ACTIVE' });
    await RemovalRequest.create({
      user: u._id,
      discordId: 'pending-1',
      reason: 'THRESHOLD',
      strikeCount: 3,
      strikeThreshold: 3,
      description: 'test',
      status: 'PENDING',
    });
    const pending = await RemovalRequest.find({ status: 'PENDING' }).lean();
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });
});
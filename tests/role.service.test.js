import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  createRole,
  editRole,
  deleteRole,
  assignRole,
  removeRole,
  listRoles,
} from '../src/services/role.service.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { Role, RoleAssignment, User } from '../src/models/index.js';
import { ConflictError, AuthorizationError, NotFoundError } from '../src/utils/errors.js';

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
});

describe('role.service', () => {
  test('createRole requires valid key and priority below actor', async () => {
    const supreme = await makeActor('supreme_command', 'a1');

    const role = await createRole(supreme.discordId, {
      key: 'event_manager',
      name: 'Event Manager',
      priority: 50,
      permissions: ['events.view', 'events.approve'],
      quotaCategory: 'NONE',
    });
    expect(role.key).toBe('event_manager');
    expect(role.priority).toBe(50);
  });

  test('createRole rejects priority ≥ actor priority', async () => {
    const high = await makeActor('high_command', 'a2');
    await expect(
      createRole(high.discordId, {
        key: 'too_high',
        name: 'Too High',
        priority: 80,
        permissions: [],
      })
    ).rejects.toThrow(AuthorizationError);
  });

  test('createRole rejects duplicate key', async () => {
    const supreme = await makeActor('supreme_command', 'a3');
    await expect(
      createRole(supreme.discordId, {
        key: 'staff',
        name: 'Staff Dup',
        priority: 20,
        permissions: [],
      })
    ).rejects.toThrow(ConflictError);
  });

  test('editRole blocks non-editable role (super_admin)', async () => {
    const admin = await makeActor('super_admin', 'a4');
    await expect(
      editRole(admin.discordId, 'super_admin', { name: 'Hacked' })
    ).rejects.toThrow(AuthorizationError);
  });

  test('deleteRole blocks roles with active assignments', async () => {
    const supreme = await makeActor('supreme_command', 'a5');
    await createRole(supreme.discordId, {
      key: 'temp',
      name: 'Temp',
      priority: 5,
      permissions: [],
    });
    const target = await User.create({ discordId: 't1', status: 'ACTIVE' });
    await assignRole(supreme.discordId, target.discordId, 'temp');

    await expect(deleteRole(supreme.discordId, 'temp')).rejects.toThrow(ConflictError);
  });

  test('assignRole is idempotent', async () => {
    const supreme = await makeActor('supreme_command', 'a6');
    const target = await User.create({ discordId: 't2', status: 'ACTIVE' });
    const first = await assignRole(supreme.discordId, target.discordId, 'staff');
    expect(first.assigned).toBe(true);
    const second = await assignRole(supreme.discordId, target.discordId, 'staff');
    expect(second.assigned).toBe(false);
  });

  test('removeRole is idempotent', async () => {
    const supreme = await makeActor('supreme_command', 'a7');
    const target = await User.create({ discordId: 't3', status: 'ACTIVE' });
    await assignRole(supreme.discordId, target.discordId, 'staff');
    const first = await removeRole(supreme.discordId, target.discordId, 'staff');
    expect(first.removed).toBe(true);
    const second = await removeRole(supreme.discordId, target.discordId, 'staff');
    expect(second.removed).toBe(false);
  });

  test('cannot assign a role at or above your own priority', async () => {
    const high = await makeActor('high_command', 'a8');
    const target = await User.create({ discordId: 't4', status: 'ACTIVE' });
    await expect(
      assignRole(high.discordId, target.discordId, 'supreme_command')
    ).rejects.toThrow(AuthorizationError);
  });

  test('assignRole on unknown user throws NotFoundError', async () => {
    const supreme = await makeActor('supreme_command', 'a9');
    await expect(
      assignRole(supreme.discordId, 'nonexistent', 'staff')
    ).rejects.toThrow(NotFoundError);
  });

  test('listRoles excludes inactive by default', async () => {
    const supreme = await makeActor('supreme_command', 'a10');
    await createRole(supreme.discordId, {
      key: 'ghost',
      name: 'Ghost',
      priority: 5,
      permissions: [],
    });
    await editRole(supreme.discordId, 'ghost', { active: false });
    const visible = await listRoles();
    expect(visible.find((r) => r.key === 'ghost')).toBeUndefined();
    const all = await listRoles({ includeInactive: true });
    expect(all.find((r) => r.key === 'ghost')).toBeDefined();
  });
});
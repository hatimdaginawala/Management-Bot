import { describe, test, expect, beforeEach, beforeAll, jest } from '@jest/globals';
import { User, Role, RoleAssignment, Strike } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';

// --- Mock discord.js reply plumbing so we can assert on outputs ---
function makeInteraction({ discordId = 'user1', commandName = 'test', customId = null } = {}) {
  const replies = [];
  const followUps = [];
  const edits = [];

  const interaction = {
    user: { id: discordId },
    commandName,
    customId,
    replied: false,
    deferred: false,
    createdTimestamp: Date.now(),
    async reply(payload) {
      this.replied = true;
      replies.push(payload);
      return { id: 'msg-1' };
    },
    async followUp(payload) {
      followUps.push(payload);
      return { id: 'msg-2' };
    },
    async editReply(payload) {
      edits.push(payload);
      return { id: 'msg-3' };
    },
    async fetchReply() {
      return { id: 'msg-1', createMessageComponentCollector: () => ({ on: () => {} }) };
    },
    // expose for assertions
    __replies: replies,
    __followUps: followUps,
    __edits: edits,
  };
  return interaction;
}

// --- Mock permissionService BEFORE importing the guard ---
// Actually, we can use the real permission service since it's backed by
// the test DB. That gives us end-to-end coverage of RBAC + guard together.
import { guard, _resetCooldowns } from '../src/bot/permissionGuard.js';

async function makeActorWithRole(discordId, roleKey, status = 'ACTIVE') {
  const user = await User.create({ discordId, status });
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
  _resetCooldowns();
});

// ===========================================================================
describe('permissionGuard — permission checks', () => {
  test('allows user with the required permission', async () => {
    await makeActorWithRole('admin-1', 'super_admin');
    const interaction = makeInteraction({ discordId: 'admin-1', commandName: 'event-create' });
    let called = false;
    await guard(interaction, { permission: 'events.create' }, async () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(interaction.__replies).toHaveLength(0);
  });

  test('rejects user without the required permission', async () => {
    await makeActorWithRole('lowrank-1', 'low_rank');
    const interaction = makeInteraction({ discordId: 'lowrank-1', commandName: 'event-create' });
    let called = false;
    await guard(interaction, { permission: 'events.create' }, async () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(interaction.__replies).toHaveLength(1);
    const embed = interaction.__replies[0].embeds[0];
    expect(embed.data.title).toBe('Permission Denied');
  });

  test('rejects unknown Discord user (no User doc)', async () => {
    const interaction = makeInteraction({ discordId: 'stranger' });
    let called = false;
    await guard(interaction, { permission: 'events.view' }, async () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(interaction.__replies).toHaveLength(1);
  });

  test('no permission required — command runs for anyone', async () => {
    const interaction = makeInteraction({ discordId: 'unknown-user' });
    let called = false;
    await guard(interaction, {}, async () => {
      called = true;
    });
    expect(called).toBe(true);
  });
});

// ===========================================================================
describe('permissionGuard — link requirement', () => {
  test('rejects unlinked user when requireLinked is true', async () => {
    const user = await User.create({ discordId: 'unlinked-1', status: 'ACTIVE' });
    const interaction = makeInteraction({ discordId: 'unlinked-1' });
    let called = false;
    await guard(interaction, { requireLinked: true }, async () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(interaction.__replies[0].embeds[0].data.title).toBe('Account Not Linked');
  });

  test('allows linked user when requireLinked is true', async () => {
    const user = await User.create({
      discordId: 'linked-1',
      robloxId: '12345',
      robloxUsername: 'TestUser',
      status: 'ACTIVE',
    });
    const interaction = makeInteraction({ discordId: 'linked-1' });
    let called = false;
    await guard(interaction, { requireLinked: true }, async (ctx) => {
      called = true;
      expect(ctx.user).toBeTruthy();
      expect(ctx.user.discordId).toBe('linked-1');
    });
    expect(called).toBe(true);
  });
});

// ===========================================================================
describe('permissionGuard — suspension', () => {
  test('rejects suspended users', async () => {
    await User.create({ discordId: 'susp-1', status: 'SUSPENDED' });
    const interaction = makeInteraction({ discordId: 'susp-1' });
    let called = false;
    await guard(interaction, {}, async () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(interaction.__replies[0].embeds[0].data.title).toBe('Account Suspended');
  });
});

// ===========================================================================
describe('permissionGuard — cooldowns', () => {
  test('enforces cooldown on second call', async () => {
    await User.create({ discordId: 'cd-1', status: 'ACTIVE' });
    const i1 = makeInteraction({ discordId: 'cd-1', commandName: 'fast' });
    const i2 = makeInteraction({ discordId: 'cd-1', commandName: 'fast' });
    let calls = 0;
    const run = async () => { calls++; };

    await guard(i1, { cooldownSeconds: 60 }, run);
    await guard(i2, { cooldownSeconds: 60 }, run);

    expect(calls).toBe(1);
    expect(i2.__replies).toHaveLength(1);
    expect(i2.__replies[0].embeds[0].data.title).toBe('Slow Down');
  });

  test('cooldown is per command', async () => {
    await User.create({ discordId: 'cd-2', status: 'ACTIVE' });
    const i1 = makeInteraction({ discordId: 'cd-2', commandName: 'a' });
    const i2 = makeInteraction({ discordId: 'cd-2', commandName: 'b' });
    let calls = 0;
    const run = async () => { calls++; };

    await guard(i1, { cooldownSeconds: 60 }, run);
    await guard(i2, { cooldownSeconds: 60 }, run);

    expect(calls).toBe(2);
  });

  test('cooldown is per user', async () => {
    await User.create({ discordId: 'cd-a', status: 'ACTIVE' });
    await User.create({ discordId: 'cd-b', status: 'ACTIVE' });
    const i1 = makeInteraction({ discordId: 'cd-a', commandName: 'x' });
    const i2 = makeInteraction({ discordId: 'cd-b', commandName: 'x' });
    let calls = 0;
    const run = async () => { calls++; };

    await guard(i1, { cooldownSeconds: 60 }, run);
    await guard(i2, { cooldownSeconds: 60 }, run);

    expect(calls).toBe(2);
  });
});

// ===========================================================================
describe('permissionGuard — error handling', () => {
  test('catches thrown errors and replies generically', async () => {
    await User.create({ discordId: 'err-1', status: 'ACTIVE' });
    const interaction = makeInteraction({ discordId: 'err-1' });
    await guard(interaction, {}, async () => {
      throw new Error('boom');
    });
    expect(interaction.__replies).toHaveLength(1);
    expect(interaction.__replies[0].embeds[0].data.title).toBe('Command Failed');
  });

  test('uses AppError message when operational', async () => {
    await User.create({ discordId: 'err-2', status: 'ACTIVE' });
    const interaction = makeInteraction({ discordId: 'err-2' });
    const { ValidationError } = await import('../src/utils/errors.js');
    await guard(interaction, {}, async () => {
      throw new ValidationError('Custom validation message');
    });
    expect(interaction.__replies[0].embeds[0].data.description).toBe('Custom validation message');
  });

  test('replies with followUp if already replied', async () => {
    await User.create({ discordId: 'err-3', status: 'ACTIVE' });
    const interaction = makeInteraction({ discordId: 'err-3' });
    interaction.replied = true;
    await guard(interaction, {}, async () => {
      throw new Error('boom');
    });
    expect(interaction.__followUps).toHaveLength(1);
    expect(interaction.__replies).toHaveLength(0);
  });
});
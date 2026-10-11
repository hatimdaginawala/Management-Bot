import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { User, Verification } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';

// --- Mock the Roblox integration before importing the service ---
const mockRoblox = {
  findUserByUsername: jest.fn(),
  getProfile: jest.fn(),
  findUserById: jest.fn(),
  findUsersByUsernames: jest.fn(),
};

jest.unstable_mockModule('../src/services/robloxUser.service.js', () => mockRoblox);

let link, verify, unlink, linkStatus, linkManual;

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await User.deleteMany({});
  await Verification.deleteMany({});
  mockRoblox.findUserByUsername.mockReset();
  mockRoblox.getProfile.mockReset();

  if (!link) {
    link = await import('../src/bot/commands/auth/link.js');
    verify = await import('../src/bot/commands/auth/verify.js');
    unlink = await import('../src/bot/commands/auth/unlink.js');
    linkStatus = await import('../src/bot/commands/auth/linkStatus.js');
    linkManual = await import('../src/bot/commands/auth/linkManual.js');
  }
});

// ---------------------------------------------------------------------------
// Mock interaction helpers
// ---------------------------------------------------------------------------
function makeSlashInteraction({ discordId, username = 'user', options = {} } = {}) {
  const replies = [];
  const interaction = {
    user: {
      id: discordId,
      username,
      async send(payload) { return { id: 'dm-1', payload }; },
    },
    replied: false,
    deferred: false,
    createdTimestamp: Date.now(),
    options: {
      getString: (name) => options[name] ?? null,
      getUser: (name) => options[name] ?? null,
    },
    async reply(payload) {
      this.replied = true;
      replies.push(payload);
      return { id: 'msg-1' };
    },
    async followUp(payload) {
      replies.push(payload);
      return { id: 'msg-2' };
    },
    async editReply(payload) {
      replies.push(payload);
      return { id: 'msg-3' };
    },
    __replies: replies,
  };
  return interaction;
}

const FAKE_ROBLOX_USER = {
  id: 123456,
  name: 'TestUser',
  displayName: 'Test User',
  isBanned: false,
};

// ===========================================================================
describe('/link', () => {
  test('creates PENDING verification and replies with a code', async () => {
    await User.create({ discordId: 'u1', status: 'UNVERIFIED' });
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);

    const i = makeSlashInteraction({
      discordId: 'u1',
      options: { roblox_username: 'TestUser' },
    });
    await link.execute(i);

    expect(i.__replies).toHaveLength(1);
    const embed = i.__replies[0].embeds[0].data;
    expect(embed.title).toBe('Roblox Account Linking');
    expect(embed.description).toMatch(/[A-Z0-9]{12}/); // the code

    const pending = await Verification.findOne({ discordId: 'u1', status: 'PENDING' });
    expect(pending).not.toBeNull();
    expect(pending.robloxUsername).toBe('TestUser');
  });

  test('replies ephemerally', async () => {
    await User.create({ discordId: 'u2', status: 'UNVERIFIED' });
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);

    const i = makeSlashInteraction({
      discordId: 'u2',
      options: { roblox_username: 'TestUser' },
    });
    await link.execute(i);

    // MessageFlags.Ephemeral is 64
    expect(i.__replies[0].flags).toBe(64);
  });
});

// ===========================================================================
describe('/verify', () => {
  test('completes verification when code is in profile', async () => {
    await User.create({ discordId: 'v1', status: 'UNVERIFIED' });
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);

    // Start via /link
    const i1 = makeSlashInteraction({
      discordId: 'v1',
      options: { roblox_username: 'TestUser' },
    });
    await link.execute(i1);

    const pending = await Verification.findOne({ discordId: 'v1', status: 'PENDING' });
    const code = pending.code;

    // Mock the profile to contain the code.
    mockRoblox.getProfile.mockResolvedValue({
      id: '123456',
      name: 'TestUser',
      displayName: 'Test User',
      description: `blah ${code} blah`,
    });

    const i2 = makeSlashInteraction({ discordId: 'v1' });
    await verify.execute(i2);

    expect(i2.__replies).toHaveLength(1);
    expect(i2.__replies[0].embeds[0].data.title).toBe('Account Verified');

    const u = await User.findOne({ discordId: 'v1' });
    expect(u.robloxId).toBe('123456');
    expect(u.status).toBe('ACTIVE');
  });

  test('throws when code not in profile', async () => {
    await User.create({ discordId: 'v2', status: 'UNVERIFIED' });
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);

    const i1 = makeSlashInteraction({
      discordId: 'v2',
      options: { roblox_username: 'TestUser' },
    });
    await link.execute(i1);

    mockRoblox.getProfile.mockResolvedValue({
      id: '123456',
      name: 'TestUser',
      displayName: 'Test User',
      description: 'no code here',
    });

    const i2 = makeSlashInteraction({ discordId: 'v2' });
    await expect(verify.execute(i2)).rejects.toThrow();
  });
});

// ===========================================================================
describe('/unlink', () => {
  test('unlinks a linked user', async () => {
    await User.create({
      discordId: 'x1',
      robloxId: '999',
      robloxUsername: 'TestUser',
      status: 'ACTIVE',
    });

    const i = makeSlashInteraction({ discordId: 'x1' });
    await unlink.execute(i);

    expect(i.__replies).toHaveLength(1);
    expect(i.__replies[0].embeds[0].data.title).toBe('Account Unlinked');

    const u = await User.findOne({ discordId: 'x1' });
    expect(u.robloxId).toBeUndefined();
    expect(u.status).toBe('UNVERIFIED');
  });
});

// ===========================================================================
describe('/link-status', () => {
  test('reports linked status', async () => {
    await User.create({
      discordId: 's1',
      robloxId: '123',
      robloxUsername: 'TestUser',
      status: 'ACTIVE',
    });

    const i = makeSlashInteraction({ discordId: 's1' });
    await linkStatus.execute(i);

    expect(i.__replies[0].embeds[0].data.title).toBe('Account Linked');
  });

  test('reports pending status when verification is pending', async () => {
    await User.create({ discordId: 's2', status: 'UNVERIFIED' });
    await Verification.create({
      discordId: 's2',
      robloxUsername: 'TestUser',
      code: 'ABCDEFGHJKLM',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const i = makeSlashInteraction({ discordId: 's2' });
    await linkStatus.execute(i);

    expect(i.__replies[0].embeds[0].data.title).toBe('Verification Pending');
  });

  test('reports not-linked for unlinked user without pending verification', async () => {
    await User.create({ discordId: 's3', status: 'UNVERIFIED' });
    const i = makeSlashInteraction({ discordId: 's3' });
    await linkStatus.execute(i);
    expect(i.__replies[0].embeds[0].data.title).toBe('Not Linked');
  });
});

// ===========================================================================
describe('/link-manual', () => {
  test('links a target user with reason', async () => {
    await User.create({ discordId: 'm1', status: 'UNVERIFIED' });
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);

    const targetUser = {
      id: 'm1',
      username: 'target',
      async send() { return { id: 'dm-x' }; },
    };

    const i = makeSlashInteraction({
      discordId: 'admin-1',
      options: {
        user: targetUser,
        roblox_username: 'TestUser',
        reason: 'Profile is private',
      },
    });

    await linkManual.execute(i);

    expect(i.__replies[0].embeds[0].data.title).toBe('Manual Link Complete');

    const u = await User.findOne({ discordId: 'm1' });
    expect(u.robloxId).toBe('123456');
    expect(u.status).toBe('ACTIVE');
  });
});
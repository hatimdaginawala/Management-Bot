import { describe, test, expect, beforeEach, beforeAll, jest } from '@jest/globals';
import { User, Verification, Settings } from '../src/models/index.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  RateLimitError,
} from '../src/utils/errors.js';

// ---------------------------------------------------------------------------
// Mock the Roblox user service BEFORE the verification service is imported.
// ESM imports are hoisted, so we register the mock here at the top, then
// dynamically import the service inside beforeAll so it sees the mock.
// ---------------------------------------------------------------------------
const mockRoblox = {
  findUserByUsername: jest.fn(),
  getProfile: jest.fn(),
  findUserById: jest.fn(),
  findUsersByUsernames: jest.fn(),
};

jest.unstable_mockModule('../src/services/robloxUser.service.js', () => mockRoblox);

let verification;

beforeAll(async () => {
  verification = await import('../src/services/verification.service.js');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function makeUser(discordId) {
  return User.create({ discordId, status: 'UNVERIFIED' });
}

const FAKE_ROBLOX_USER = {
  id: 123456,
  name: 'TestUser',
  displayName: 'Test User',
  isBanned: false,
};

const FAKE_PROFILE_OK = {
  id: '123456',
  name: 'TestUser',
  displayName: 'Test User',
  description: '', // each test replaces
};

beforeEach(async () => {
  await seedSettings();
  await seedPermissions();
  await seedRoles();
  mockRoblox.findUserByUsername.mockReset();
  mockRoblox.getProfile.mockReset();
  mockRoblox.findUserById.mockReset();
  mockRoblox.findUsersByUsernames.mockReset();
});

// ===========================================================================
// startVerification
// ===========================================================================
describe('verification.service — startVerification', () => {
  test('happy path creates PENDING with a code', async () => {
    await makeUser('u1');
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);

    const { verification: v, robloxUser } = await verification.startVerification(
      'u1',
      'TestUser'
    );

    expect(robloxUser.name).toBe('TestUser');
    expect(v.status).toBe('PENDING');
    expect(v.code).toHaveLength(12);
    expect(v.robloxId).toBe('123456');
  });

  test('rejects invalid username format', async () => {
    await makeUser('u2');
    await expect(
      verification.startVerification('u2', 'has space')
    ).rejects.toThrow(ValidationError);
  });

  test('rejects if user already linked', async () => {
    const user = await makeUser('u3');
    user.robloxId = '999';
    user.robloxUsername = 'Other';
    await user.save();
    await expect(
      verification.startVerification('u3', 'TestUser')
    ).rejects.toThrow(ConflictError);
  });

  test('rejects if Roblox user does not exist', async () => {
    await makeUser('u4');
    mockRoblox.findUserByUsername.mockResolvedValue(null);
    await expect(
      verification.startVerification('u4', 'NoSuchUser')
    ).rejects.toThrow(NotFoundError);
  });

  test('rejects if Roblox already linked to another Discord', async () => {
    const other = await makeUser('u5-other');
    other.robloxId = '123456';
    other.robloxUsername = 'TestUser';
    await other.save();

    await makeUser('u5');
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);

    await expect(
      verification.startVerification('u5', 'TestUser')
    ).rejects.toThrow(ConflictError);
  });

  test('supersedes prior PENDING verification', async () => {
    await makeUser('u6');
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);

    const first = await verification.startVerification('u6', 'TestUser');
    const second = await verification.startVerification('u6', 'TestUser');

    const reloaded = await Verification.findById(first.verification._id);
    expect(reloaded.status).toBe('CANCELLED');
    expect(second.verification.status).toBe('PENDING');

    const pendingCount = await Verification.countDocuments({
      discordId: 'u6',
      status: 'PENDING',
    });
    expect(pendingCount).toBe(1);
  });

  test('enforces re-link cooldown (D12)', async () => {
    const user = await makeUser('u7');
    user.lastUnlinkedAt = new Date();
    await user.save();

    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);

    await expect(
      verification.startVerification('u7', 'TestUser')
    ).rejects.toThrow(RateLimitError);
  });
});

// ===========================================================================
// completeVerification
// ===========================================================================
describe('verification.service — completeVerification', () => {
  test('happy path links the account', async () => {
    await makeUser('c1');
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);

    const { verification: v } = await verification.startVerification(
      'c1',
      'TestUser'
    );

    mockRoblox.getProfile.mockResolvedValue({
      ...FAKE_PROFILE_OK,
      description: `Hi. ${v.code} .`,
    });

    const result = await verification.completeVerification('c1');
    expect(result.user.robloxId).toBe('123456');
    expect(result.user.status).toBe('ACTIVE');

    const reloaded = await Verification.findById(v._id);
    expect(reloaded.status).toBe('VERIFIED');
    expect(reloaded.verifiedAt).toBeInstanceOf(Date);
  });

  test('rejects when no pending verification exists', async () => {
    await expect(verification.completeVerification('nobody')).rejects.toThrow(
      NotFoundError
    );
  });

  test('rejects when code not found in profile, increments attempts', async () => {
    await makeUser('c2');
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);
    const { verification: v } = await verification.startVerification(
      'c2',
      'TestUser'
    );

    mockRoblox.getProfile.mockResolvedValue({
      ...FAKE_PROFILE_OK,
      description: 'No code here',
    });

    await expect(verification.completeVerification('c2')).rejects.toThrow(
      ValidationError
    );

    const reloaded = await Verification.findById(v._id);
    expect(reloaded.attempts).toBe(1);
    expect(reloaded.status).toBe('PENDING');
  });

  test('rejects when expired', async () => {
    await makeUser('c3');
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);
    const { verification: v } = await verification.startVerification(
      'c3',
      'TestUser'
    );

    v.expiresAt = new Date(Date.now() - 60_000);
    await v.save();

    await expect(verification.completeVerification('c3')).rejects.toThrow(
      ValidationError
    );

    const reloaded = await Verification.findById(v._id);
    expect(reloaded.status).toBe('EXPIRED');
  });

  test('rejects after max attempts', async () => {
    await makeUser('c4');
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);
    const { verification: v } = await verification.startVerification(
      'c4',
      'TestUser'
    );

    v.attempts = 5;
    await v.save();

    await expect(verification.completeVerification('c4')).rejects.toThrow(
      RateLimitError
    );

    const reloaded = await Verification.findById(v._id);
    expect(reloaded.status).toBe('FAILED');
  });
});

// ===========================================================================
// manualLink
// ===========================================================================
describe('verification.service — manualLink', () => {
  test('links without a code when given permission', async () => {
    await makeUser('m1');
    mockRoblox.findUserByUsername.mockResolvedValue(FAKE_ROBLOX_USER);

    const { user } = await verification.manualLink({
      actorId: 'admin',
      targetDiscordId: 'm1',
      robloxUsernameRaw: 'TestUser',
      reason: 'Profile is private',
    });

    expect(user.robloxId).toBe('123456');
    expect(user.status).toBe('ACTIVE');
  });

  test('requires a reason', async () => {
    await makeUser('m2');
    await expect(
      verification.manualLink({
        actorId: 'admin',
        targetDiscordId: 'm2',
        robloxUsernameRaw: 'TestUser',
        reason: '',
      })
    ).rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
// unlinkSelf
// ===========================================================================
describe('verification.service — unlinkSelf', () => {
  test('clears identity and sets UNVERIFIED', async () => {
    const user = await makeUser('x1');
    user.robloxId = '123456';
    user.robloxUsername = 'TestUser';
    user.status = 'ACTIVE';
    await user.save();

    const result = await verification.unlinkSelf('x1');
    expect(result.robloxId).toBeUndefined();
    expect(result.status).toBe('UNVERIFIED');
    expect(result.lastUnlinkedAt).toBeInstanceOf(Date);
  });

  test('rejects if not linked', async () => {
    await makeUser('x2');
    await expect(verification.unlinkSelf('x2')).rejects.toThrow(ValidationError);
  });
});
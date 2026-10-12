import crypto from 'node:crypto';
import * as verificationRepo from '../db/repositories/verification.repository.js';
import * as userRepo from '../db/repositories/user.repository.js';
import * as settingsRepo from '../db/repositories/settings.repository.js';
import * as robloxUserService from './robloxUser.service.js';
import { audit } from '../utils/audit.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ExternalAPIError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

const CODE_LENGTH = 12;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ============================================================
//  Code generation
// ============================================================

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

// ============================================================
//  Settings helpers — read from the settings repository
// ============================================================

const SETTING_DEFAULTS = {
  ttlMinutes: 30,
  maxAttempts: 5,
  relinkCooldownDays: 7,
};

async function getVerificationSettings() {
  const keys = [
    ['verification.codeTtlMinutes', 'ttlMinutes'],
    ['verification.maxAttempts', 'maxAttempts'],
    ['verification.relinkCooldownDays', 'relinkCooldownDays'],
  ];
  const out = { ...SETTING_DEFAULTS };
  for (const [settingKey, outKey] of keys) {
    const row = await settingsRepo.findByKey(settingKey);
    if (row) {
      const parsed = safeParse(row.value_json);
      if (typeof parsed === 'number') out[outKey] = parsed;
    }
  }
  return out;
}

function safeParse(json) {
  try {
    return typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
}

// ============================================================
//  Validation
// ============================================================

function validateRobloxUsername(username) {
  if (typeof username !== 'string') {
    throw new ValidationError('Roblox username must be a string.');
  }
  const trimmed = username.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(trimmed)) {
    throw new ValidationError(
      'Roblox username must be 3–20 characters and contain only letters, digits, and underscores.'
    );
  }
  return trimmed;
}

// ============================================================
//  /link — start the flow
// ============================================================

export async function startVerification(discordId, robloxUsernameRaw) {
  const robloxUsername = validateRobloxUsername(robloxUsernameRaw);

  const user = await userRepo.findByDiscordId(discordId);
  if (!user) {
    throw new NotFoundError(
      'User',
      { discordId, hint: 'User must interact with the bot once before linking.' }
    );
  }
  if (user.roblox_id) {
    throw new ConflictError(
      'Your Discord account is already linked to a Roblox account. Use /unlink first.'
    );
  }

  // Cooldown (D12)
  const { relinkCooldownDays } = await getVerificationSettings();
  if (user.last_unlinked_at) {
    const cooldownEnds = new Date(
      new Date(user.last_unlinked_at).getTime() +
        relinkCooldownDays * 24 * 60 * 60 * 1000
    );
    if (cooldownEnds > new Date()) {
      throw new RateLimitError(
        'You unlinked recently. You can re-link after ' + cooldownEnds.toISOString() + '.'
      );
    }
  }

  // Roblox account lookup
  const robloxUser = await robloxUserService.findUserByUsername(robloxUsername);
  if (!robloxUser) {
    throw new NotFoundError('Roblox user', { username: robloxUsername });
  }
  if (robloxUser.isBanned) {
    throw new ValidationError('That Roblox account is banned.');
  }

  // Already linked to another Discord?
  const existingLink = await userRepo.findByRobloxId(String(robloxUser.id));
  if (existingLink && existingLink.discord_id !== discordId) {
    throw new ConflictError(
      'That Roblox account is already linked to another Discord account.'
    );
  }

  // Cancel any prior PENDING verification for this user
  await verificationRepo.cancelPendingFor(discordId, 'Superseded by a newer /link');

  const { ttlMinutes } = await getVerificationSettings();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  // Try up to 5 times to allocate a unique code
  let verification = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      verification = await verificationRepo.create({
        discordId,
        robloxUsername: robloxUser.name,
        robloxId: String(robloxUser.id),
        code,
        status: 'PENDING',
        expiresAt,
        initiatedFrom: 'DISCORD',
      });
      break;
    } catch (err) {
      if (err instanceof ConflictError) continue;
      throw err;
    }
  }
  if (!verification) {
    throw new ExternalAPIError('Verification', 'Could not allocate a unique code.');
  }

  await audit({
    actorId: discordId,
    action: 'verification.started',
    category: 'USER',
    targetType: 'User',
    targetId: user.id,
    after: { robloxUsername: robloxUser.name, expiresAt },
  });

  logger.info(
    { discordId, robloxUsername: robloxUser.name, expiresAt },
    'Verification started'
  );

  return { verification, robloxUser };
}

// ============================================================
//  /verify — complete the flow
// ============================================================

export async function completeVerification(discordId) {
  const verification = await verificationRepo.findPendingByDiscordId(discordId);
  if (!verification) {
    throw new NotFoundError(
      'Pending verification',
      { discordId, hint: 'Run /link <roblox_username> first.' }
    );
  }

  // Expiry check
  if (new Date(verification.expires_at) < new Date()) {
    await verificationRepo.updateById(verification.id, {
      status: 'EXPIRED',
      failureReason: 'Code expired before /verify was run.',
    });
    throw new ValidationError(
      'Your verification code has expired. Run /link again to get a new one.'
    );
  }

  const { maxAttempts } = await getVerificationSettings();
  if (verification.attempts >= maxAttempts) {
    await verificationRepo.updateById(verification.id, {
      status: 'FAILED',
      failureReason: 'Exceeded ' + maxAttempts + ' verification attempts.',
    });
    throw new RateLimitError(
      'Too many verification attempts. Run /link again to start over.'
    );
  }

  const profile = await robloxUserService.getProfile(verification.roblox_id);
  if (!profile) {
    await verificationRepo.updateById(verification.id, {
      attempts: verification.attempts + 1,
    });
    throw new NotFoundError('Roblox profile', { robloxId: verification.roblox_id });
  }

  const about = profile.description ?? '';
  const found = about.includes(verification.code);

  if (!found) {
    await verificationRepo.updateById(verification.id, {
      attempts: verification.attempts + 1,
    });
    throw new ValidationError(
      'Verification code not found in your Roblox profile. ' +
      'Paste it in your About section and try again. (' +
      (maxAttempts - verification.attempts - 1) + ' attempts left)'
    );
  }

  // Race check: another verify might have linked this Roblox account
  const alreadyLinked = await userRepo.findByRobloxId(verification.roblox_id);
  if (alreadyLinked && alreadyLinked.discord_id !== discordId) {
    await verificationRepo.updateById(verification.id, {
      status: 'FAILED',
      failureReason: 'Roblox account linked to another Discord during verification.',
    });
    throw new ConflictError(
      'That Roblox account was linked to another Discord account during verification.'
    );
  }

  const { user } = await linkRobloxIdentity({
    discordId,
    robloxId: verification.roblox_id,
    robloxUsername: profile.name,
    robloxDisplayName: profile.displayName,
    actorId: discordId,
    source: 'VERIFY',
  });

  await verificationRepo.updateById(verification.id, {
    status: 'VERIFIED',
    verifiedAt: new Date(),
  });

  logger.info(
    { discordId, robloxId: verification.roblox_id, robloxUsername: profile.name },
    'Verification complete'
  );

  const reloaded = await verificationRepo.findById(verification.id);
  return { user, robloxUser: profile, verification: reloaded };
}

// ============================================================
//  Manual link
// ============================================================

export async function manualLink({
  actorId,
  targetDiscordId,
  robloxUsernameRaw,
  reason,
}) {
  const robloxUsername = validateRobloxUsername(robloxUsernameRaw);

  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('A reason is required for manual linking.');
  }

  const user = await userRepo.findByDiscordId(targetDiscordId);
  if (!user) throw new NotFoundError('User', { discordId: targetDiscordId });

  if (user.roblox_id) {
    throw new ConflictError(
      'User is already linked. Unlink first if you intend to change the account.'
    );
  }

  const robloxUser = await robloxUserService.findUserByUsername(robloxUsername);
  if (!robloxUser) {
    throw new NotFoundError('Roblox user', { username: robloxUsername });
  }
  if (robloxUser.isBanned) {
    throw new ValidationError('That Roblox account is banned.');
  }

  const existingLink = await userRepo.findByRobloxId(String(robloxUser.id));
  if (existingLink) {
    throw new ConflictError(
      'That Roblox account is already linked to another Discord account.'
    );
  }

  await verificationRepo.cancelPendingFor(
    targetDiscordId,
    'Superseded by manual link by ' + actorId
  );

  const { user: updated } = await linkRobloxIdentity({
    discordId: targetDiscordId,
    robloxId: String(robloxUser.id),
    robloxUsername: robloxUser.name,
    robloxDisplayName: robloxUser.displayName,
    actorId,
    source: 'MANUAL',
    reason,
  });

  logger.info(
    { actorId, targetDiscordId, robloxId: robloxUser.id },
    'Manual link complete'
  );

  return { user: updated, robloxUser };
}

// ============================================================
//  /unlink
// ============================================================

export async function unlinkSelf(discordId) {
  const user = await userRepo.findByDiscordId(discordId);
  if (!user) throw new NotFoundError('User', { discordId });
  if (!user.roblox_id) {
    throw new ValidationError('Your account is not linked.');
  }

  const previousRobloxId = user.roblox_id;
  const previousRobloxUsername = user.roblox_username;

  const updated = await userRepo.updateByDiscordId(discordId, {
    robloxId: null,
    robloxUsername: null,
    robloxDisplayName: null,
    robloxRankId: null,
    robloxRankName: null,
    robloxRankValue: null,
    robloxLastSyncedAt: null,
    status: 'UNVERIFIED',
    lastUnlinkedAt: new Date(),
  });

  await audit({
    actorId: discordId,
    action: 'verification.unlinked',
    category: 'USER',
    targetType: 'User',
    targetId: user.id,
    before: { robloxId: previousRobloxId, robloxUsername: previousRobloxUsername },
    after: { robloxId: null, status: 'UNVERIFIED' },
  });

  logger.info({ discordId, previousRobloxId }, 'User unlinked');
  return updated;
}

// ============================================================
//  Status
// ============================================================

export async function getLinkStatus(discordId) {
  const [user, pending] = await Promise.all([
    userRepo.findByDiscordId(discordId),
    verificationRepo.findPendingByDiscordId(discordId),
  ]);
  return { user, pending };
}

// ============================================================
//  Internal — the single write path
// ============================================================

async function linkRobloxIdentity({
  discordId,
  robloxId,
  robloxUsername,
  robloxDisplayName,
  actorId,
  source,
  reason = null,
}) {
  const user = await userRepo.findByDiscordId(discordId);
  if (!user) throw new NotFoundError('User', { discordId });

  const before = {
    robloxId: user.roblox_id,
    robloxUsername: user.roblox_username,
    status: user.status,
  };

  let updated;
  try {
    updated = await userRepo.updateByDiscordId(discordId, {
      robloxId: String(robloxId),
      robloxUsername,
      robloxDisplayName: robloxDisplayName ?? robloxUsername,
      status: 'ACTIVE',
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      throw new ConflictError(
        'That Roblox account is already linked to another Discord account.'
      );
    }
    throw err;
  }

  await audit({
    actorId,
    action: source === 'MANUAL' ? 'verification.manual_link' : 'verification.linked',
    category: 'USER',
    targetType: 'User',
    targetId: updated.id,
    before,
    after: {
      robloxId: updated.roblox_id,
      robloxUsername: updated.roblox_username,
      status: updated.status,
    },
    reason,
    context: { source },
  });

  return { user: updated };
}
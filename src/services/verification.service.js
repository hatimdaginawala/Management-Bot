import crypto from 'node:crypto';
import { Verification, User } from '../models/index.js';
import { Settings } from '../models/index.js';
import { audit } from '../utils/audit.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ExternalAPIError,
} from '../utils/errors.js';
import * as robloxUserService from './robloxUser.service.js';
import logger from '../config/logger.js';

const CODE_LENGTH = 12;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1
const DEFAULT_TTL_MINUTES = 30;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RELINK_COOLDOWN_DAYS = 7;

/**
 * Verification service.
 *
 * Owns the /link → /verify lifecycle. Nothing else writes to the
 * Verification collection.
 */

// ============================================================
//  Code generation
// ============================================================

function generateCode() {
  // crypto.randomInt is CSPRNG-backed and unbiased for our alphabet size.
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

// ============================================================
//  Settings helpers
// ============================================================

async function getVerificationSettings() {
  const s = await Settings.findOne({ key: 'global' }).lean();
  return {
    ttlMinutes: s?.verification?.codeTtlMinutes ?? DEFAULT_TTL_MINUTES,
    maxAttempts: s?.verification?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    relinkCooldownDays:
      s?.verification?.relinkCooldownDays ?? DEFAULT_RELINK_COOLDOWN_DAYS,
  };
}

// ============================================================
//  Validation helpers
// ============================================================

/**
 * Roblox usernames: 3–20 chars, letters/digits/underscore.
 */
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
//  /link — begin the flow
// ============================================================

/**
 * Begin verification: create a PENDING Verification with a fresh code.
 * Returns { verification, robloxUser } so the caller can build the reply.
 */
export async function startVerification(discordId, robloxUsernameRaw) {
  const robloxUsername = validateRobloxUsername(robloxUsernameRaw);

  // 1. Ensure we have a User row for this Discord.
  const user = await User.findOne({ discordId });
  if (!user) {
    throw new NotFoundError(
      'User',
      { discordId, hint: 'User must interact with the bot once before linking.' }
    );
  }
  if (user.robloxId) {
    throw new ConflictError(
      'Your Discord account is already linked to a Roblox account. Use /unlink first.'
    );
  }

  // 2. Enforce re-link cooldown (D12).
  const { relinkCooldownDays } = await getVerificationSettings();
  if (user.lastUnlinkedAt) {
    const cooldownEnds = new Date(
      user.lastUnlinkedAt.getTime() + relinkCooldownDays * 24 * 60 * 60 * 1000
    );
    if (cooldownEnds > new Date()) {
      throw new RateLimitError(
        `You unlinked recently. You can re-link after ${cooldownEnds.toISOString()}.`
      );
    }
  }

  // 3. Look up the Roblox user via public API.
  const robloxUser = await robloxUserService.findUserByUsername(robloxUsername);
  if (!robloxUser) {
    throw new NotFoundError('Roblox user', { username: robloxUsername });
  }
  if (robloxUser.isBanned) {
    throw new ValidationError('That Roblox account is banned.');
  }

  // 4. Is this Roblox account already linked to another Discord?
  const existingLink = await User.findOne({ robloxId: String(robloxUser.id) });
  if (existingLink && existingLink.discordId !== discordId) {
    throw new ConflictError(
      'That Roblox account is already linked to another Discord account.'
    );
  }

  // 5. Cancel any existing PENDING verification for this Discord user.
  //    This is safe because the partial unique index `uniq_pending_per_user`
  //    allows only one PENDING per user. Cancelling first avoids E11000.
  await Verification.updateMany(
    { discordId, status: 'PENDING' },
    { $set: { status: 'CANCELLED', failureReason: 'Superseded by a newer /link' } }
  );

  // 6. Compute expiry.
  const { ttlMinutes } = await getVerificationSettings();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  // 7. Insert. Very small chance of code collision with an existing
  //    PENDING/VERIFIED doc — the unique index on `code` catches it.
  let verification;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      verification = await Verification.create({
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
      if (err.code === 11000) continue; // code collision, try again
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
    targetId: user._id,
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

/**
 * Complete verification by checking the user's Roblox About field
 * for the code. Returns { user, robloxUser } on success.
 */
export async function completeVerification(discordId) {
  const verification = await Verification.findOne({
    discordId,
    status: 'PENDING',
  });
  if (!verification) {
    throw new NotFoundError(
      'Pending verification',
      { discordId, hint: 'Run /link <roblox_username> first.' }
    );
  }

  // Expiry check.
  if (verification.expiresAt < new Date()) {
    verification.status = 'EXPIRED';
    verification.failureReason = 'Code expired before /verify was run.';
    await verification.save();
    throw new ValidationError(
      'Your verification code has expired. Run /link again to get a new one.'
    );
  }

  const { maxAttempts } = await getVerificationSettings();
  if (verification.attempts >= maxAttempts) {
    verification.status = 'FAILED';
    verification.failureReason = `Exceeded ${maxAttempts} verification attempts.`;
    await verification.save();
    throw new RateLimitError(
      `Too many verification attempts. Run /link again to start over.`
    );
  }

  // Read the profile.
  const profile = await robloxUserService.getProfile(verification.robloxId);
  if (!profile) {
    verification.attempts += 1;
    await verification.save();
    throw new NotFoundError('Roblox profile', { robloxId: verification.robloxId });
  }

  // The code must appear in the About field.
  const about = profile.description ?? '';
  const found = about.includes(verification.code);

  if (!found) {
    verification.attempts += 1;
    await verification.save();
    throw new ValidationError(
      `Verification code not found in your Roblox profile. ` +
      `Paste it in your About section and try again. ` +
      `(${maxAttempts - verification.attempts} attempts left)`
    );
  }

  // Race check: another concurrent /verify might have linked this Roblox
  // account to a different Discord just now. The unique index catches it,
  // but we can pre-check to give a nicer error.
  const alreadyLinked = await User.findOne({ robloxId: verification.robloxId });
  if (alreadyLinked && alreadyLinked.discordId !== discordId) {
    verification.status = 'FAILED';
    verification.failureReason = 'Roblox account linked to another Discord during verification.';
    await verification.save();
    throw new ConflictError(
      'That Roblox account was linked to another Discord account during verification.'
    );
  }

  // Link!
  const { user } = await linkRobloxIdentity({
    discordId,
    robloxId: verification.robloxId,
    robloxUsername: profile.name,
    robloxDisplayName: profile.displayName,
    actorId: discordId,
    source: 'VERIFY',
  });

  verification.status = 'VERIFIED';
  verification.verifiedAt = new Date();
  await verification.save();

  logger.info(
    { discordId, robloxId: verification.robloxId, robloxUsername: profile.name },
    'Verification complete'
  );

  return { user, robloxUser: profile, verification };
}

// ============================================================
//  Manual link (High Command+)
// ============================================================

/**
 * Manually link a Discord user to a Roblox account, bypassing the
 * code flow. Requires `verification.manualLink` permission — the
 * caller (Discord command) enforces that; this function trusts it.
 */
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

  const user = await User.findOne({ discordId: targetDiscordId });
  if (!user) throw new NotFoundError('User', { discordId: targetDiscordId });

  if (user.robloxId) {
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

  const existingLink = await User.findOne({ robloxId: String(robloxUser.id) });
  if (existingLink) {
    throw new ConflictError(
      'That Roblox account is already linked to another Discord account.'
    );
  }

  // Cancel any pending self-service verification for this user.
  await Verification.updateMany(
    { discordId: targetDiscordId, status: 'PENDING' },
    {
      $set: {
        status: 'CANCELLED',
        failureReason: `Superseded by manual link by ${actorId}`,
      },
    }
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

/**
 * Unlink a Discord user from their Roblox account.
 * Only self-service in Phase 4 (D11). Admin unlink is deferred.
 */
export async function unlinkSelf(discordId) {
  const user = await User.findOne({ discordId });
  if (!user) throw new NotFoundError('User', { discordId });
  if (!user.robloxId) {
    throw new ValidationError('Your account is not linked.');
  }

  const previousRobloxId = user.robloxId;
  const previousRobloxUsername = user.robloxUsername;

  // Clear Roblox identity; keep history in AuditLog.
  user.robloxId = undefined;
  user.robloxUsername = null;
  user.set('roblox', {});
  user.status = 'UNVERIFIED';
  user.lastUnlinkedAt = new Date();
  await user.save();

  await audit({
    actorId: discordId,
    action: 'verification.unlinked',
    category: 'USER',
    targetType: 'User',
    targetId: user._id,
    before: { robloxId: previousRobloxId, robloxUsername: previousRobloxUsername },
    after: { robloxId: null, status: 'UNVERIFIED' },
  });

  logger.info({ discordId, previousRobloxId }, 'User unlinked');
  return user;
}

// ============================================================
//  Status inspection
// ============================================================

export async function getLinkStatus(discordId) {
  const [user, pending] = await Promise.all([
    User.findOne({ discordId }).lean(),
    Verification.findOne({ discordId, status: 'PENDING' }).lean(),
  ]);
  return { user, pending };
}

// ============================================================
//  Internal — the single write path that links an identity
// ============================================================

/**
 * The ONLY place that writes Roblox identity onto a User document.
 * Centralized so audits and future side-effects (role recompute,
 * welcome DM) happen exactly once.
 *
 * Idempotency:
 *   The `uniq_robloxId_sparse` index on User rejects a second Discord
 *   trying to link the same Roblox ID. We catch E11000 and translate.
 */
async function linkRobloxIdentity({
  discordId,
  robloxId,
  robloxUsername,
  robloxDisplayName,
  actorId,
  source,
  reason = null,
}) {
  const user = await User.findOne({ discordId });
  if (!user) throw new NotFoundError('User', { discordId });

  const before = {
    robloxId: user.robloxId,
    robloxUsername: user.robloxUsername,
    status: user.status,
  };

  user.robloxId = String(robloxId);
  user.robloxUsername = robloxUsername;
  user.set('roblox', {
    username: robloxUsername,
    displayName: robloxDisplayName ?? robloxUsername,
    rankId: user.roblox?.rankId ?? null,
    rankName: user.roblox?.rankName ?? null,
    rankValue: user.roblox?.rankValue ?? null,
    lastSyncedAt: user.roblox?.lastSyncedAt ?? null,
  });
  user.status = 'ACTIVE';

  try {
    await user.save();
  } catch (err) {
    if (err.code === 11000) {
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
    targetId: user._id,
    before,
    after: {
      robloxId: user.robloxId,
      robloxUsername: user.robloxUsername,
      status: user.status,
    },
    reason,
    context: { source },
  });

  return { user };
}
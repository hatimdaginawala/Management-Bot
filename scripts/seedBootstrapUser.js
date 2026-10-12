import * as userRepo from '../src/db/repositories/user.repository.js';
import * as roleRepo from '../src/db/repositories/role.repository.js';
import * as roleAssignmentRepo from '../src/db/repositories/roleAssignment.repository.js';
import logger from '../src/config/logger.js';

/**
 * Bootstrap user seed.
 *
 * Creates (or updates) a single hardcoded user — the server operator —
 * and assigns them super_admin. This makes a fresh install immediately
 * usable without any manual SQL.
 *
 * Idempotent:
 *   - If the user doesn't exist -> create it.
 *   - If the user exists -> update only safe fields (Roblox identity).
 *   - If the super_admin assignment exists and is active -> skip.
 *   - If the super_admin assignment exists but inactive -> reactivate.
 */

// ============================================================
//  Configuration — edit this to match your operator account
// ============================================================
const BOOTSTRAP = {
  discordId: '820331262816157776',
  discordUsername: 'slayer53110',
  robloxId: '465706288',
  robloxUsername: 'slayer53110',
  robloxDisplayName: 'slayer',
  robloxRankId: 61996220,
  robloxRankName: 'Assault Lieutenant',
  robloxRankValue: 180,
  status: 'ACTIVE',
  quotaCategory: 'NONE',
};

export async function seedBootstrapUser() {
  let userCreated = false;
  let userUpdated = false;
  let roleAssigned = false;
  let roleSkipped = false;

  // ---------- User row ----------
  let user = await userRepo.findByDiscordId(BOOTSTRAP.discordId);

  if (!user) {
    user = await userRepo.create({
      discordId: BOOTSTRAP.discordId,
      discordUsername: BOOTSTRAP.discordUsername,
      robloxId: BOOTSTRAP.robloxId,
      robloxUsername: BOOTSTRAP.robloxUsername,
      robloxDisplayName: BOOTSTRAP.robloxDisplayName,
      robloxRankId: BOOTSTRAP.robloxRankId,
      robloxRankName: BOOTSTRAP.robloxRankName,
      robloxRankValue: BOOTSTRAP.robloxRankValue,
      robloxLastSyncedAt: new Date(),
      status: BOOTSTRAP.status,
      quotaCategory: BOOTSTRAP.quotaCategory,
      quotaExempt: false,
    });
    userCreated = true;
    logger.info(
      { discordId: BOOTSTRAP.discordId, robloxId: BOOTSTRAP.robloxId },
      'Bootstrap user created'
    );
  } else {
    // Update only the Roblox-owned identity fields and status if they
    // differ. Never touches application-owned fields like quota_exempt.
    const patch = {};
    if (user.roblox_id !== BOOTSTRAP.robloxId) patch.robloxId = BOOTSTRAP.robloxId;
    if (user.roblox_username !== BOOTSTRAP.robloxUsername) patch.robloxUsername = BOOTSTRAP.robloxUsername;
    if (user.roblox_display_name !== BOOTSTRAP.robloxDisplayName) patch.robloxDisplayName = BOOTSTRAP.robloxDisplayName;
    if (user.roblox_rank_id !== BOOTSTRAP.robloxRankId) patch.robloxRankId = BOOTSTRAP.robloxRankId;
    if (user.roblox_rank_name !== BOOTSTRAP.robloxRankName) patch.robloxRankName = BOOTSTRAP.robloxRankName;
    if (user.roblox_rank_value !== BOOTSTRAP.robloxRankValue) patch.robloxRankValue = BOOTSTRAP.robloxRankValue;
    if (user.discord_username !== BOOTSTRAP.discordUsername) patch.discordUsername = BOOTSTRAP.discordUsername;
    if (user.status !== BOOTSTRAP.status) patch.status = BOOTSTRAP.status;

    if (Object.keys(patch).length > 0) {
      patch.robloxLastSyncedAt = new Date();
      user = await userRepo.updateById(user.id, patch);
      userUpdated = true;
      logger.info(
        { discordId: BOOTSTRAP.discordId, fields: Object.keys(patch) },
        'Bootstrap user updated'
      );
    }
  }

  // ---------- super_admin role assignment ----------
  const superAdminRole = await roleRepo.findByKey('super_admin');
  if (!superAdminRole) {
    logger.warn('super_admin role not found — skipping bootstrap role assignment');
    return { userCreated, userUpdated, roleAssigned, roleSkipped };
  }

  const existingActive = await roleAssignmentRepo.findActiveByUserAndRole(
    user.id,
    superAdminRole.id
  );

  if (existingActive) {
    roleSkipped = true;
    logger.info(
      { discordId: BOOTSTRAP.discordId },
      'Bootstrap super_admin assignment already active — skipping'
    );
  } else {
    await roleAssignmentRepo.ensureActive({
      userId: user.id,
      discordId: user.discord_id,
      roleId: superAdminRole.id,
      roleKey: superAdminRole.key,
      assignedBy: 'bootstrap',
      reason: 'Seed: initial operator bootstrap',
    });
    roleAssigned = true;
    logger.info(
      { discordId: BOOTSTRAP.discordId },
      'Bootstrap super_admin assigned'
    );
  }

  // Recompute quota category (will be NONE, since super_admin has NONE).
  // We just set it directly; no need to call userService here.
  // Done above.

  return { userCreated, userUpdated, roleAssigned, roleSkipped };
}
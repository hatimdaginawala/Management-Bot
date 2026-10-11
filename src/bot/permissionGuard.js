import { MessageFlags } from 'discord.js';
import { User } from '../models/index.js';
import * as permissionService from '../services/permission.service.js';
import { errorEmbed } from './embedBuilders.js';
import logger from '../config/logger.js';

/**
 * Permission guard for Discord interactions.
 *
 * Wraps the `execute` function of every command / button / modal /
 * select menu. Responsibilities:
 *
 *   1. Resolve the acting user (by Discord ID).
 *   2. Enforce permission requirement (if declared in meta).
 *   3. Enforce "user must be linked to Roblox" (if requireLinked).
 *   4. Enforce the user is not SUSPENDED.
 *   5. Enforce a per-user cooldown (if declared).
 *   6. Reply with a clean ephemeral error on any failure.
 *   7. Reply generically on unexpected errors; log the real one.
 *
 * Usage:
 *   const result = await guard(interaction, meta, async (ctx) => {...});
 */

const cooldowns = new Map(); // discordId -> Map<key, lastRunMs>
const MAX_COOLDOWN_MS = 60 * 1000; // absolute cap

export async function guard(interaction, meta, handler) {
  const discordId = interaction.user?.id;
  if (!discordId) {
    await safeReply(interaction, errorEmbed({
      title: 'Interaction Error',
      description: 'Could not identify your Discord account.',
    }));
    return;
  }

  // 1. Load User (may be null; some commands allow unlinked users).
  const user = await User.findOne({ discordId });

  // 2. If the command requires linking, enforce it.
  if (meta?.requireLinked && (!user || !user.robloxId)) {
    await safeReply(interaction, errorEmbed({
      title: 'Account Not Linked',
      description: 'You must link your Roblox account first. Use `/link <roblox_username>` to begin.',
    }));
    return;
  }

  // 3. Suspended users cannot interact, period.
  if (user && user.status === 'SUSPENDED') {
    await safeReply(interaction, errorEmbed({
      title: 'Account Suspended',
      description: 'Your account is currently suspended. Contact High Command if you believe this is an error.',
    }));
    return;
  }

  // 4. Permission check.
  if (meta?.permission) {
    // If no User doc, they have no permissions.
    if (!user) {
      await safeReply(interaction, errorEmbed({
        title: 'Permission Denied',
        description: 'You do not have permission to perform this action.',
      }));
      return;
    }
    const allowed = await permissionService.hasPermission(user._id, meta.permission);
    if (!allowed) {
      logger.debug(
        { discordId, permission: meta.permission, command: interaction.commandName ?? interaction.customId },
        'Permission denied'
      );
      await safeReply(interaction, errorEmbed({
        title: 'Permission Denied',
        description: 'You do not have permission to perform this action.',
      }));
      return;
    }
  }

  // 5. Cooldown.
  const cooldownSeconds = Number(meta?.cooldownSeconds) || 0;
  if (cooldownSeconds > 0 && cooldownSeconds * 1000 <= MAX_COOLDOWN_MS) {
    const key = interaction.commandName ?? interaction.customId ?? 'unknown';
    const userCooldowns = cooldowns.get(discordId) ?? new Map();
    const last = userCooldowns.get(key) ?? 0;
    const wait = last + cooldownSeconds * 1000 - Date.now();
    if (wait > 0) {
      const secs = Math.ceil(wait / 1000);
      await safeReply(interaction, errorEmbed({
        title: 'Slow Down',
        description: `Please wait ${secs}s before running this command again.`,
      }));
      return;
    }
    userCooldowns.set(key, Date.now());
    cooldowns.set(discordId, userCooldowns);
  }

  // 6. Execute.
  try {
    await handler({ user });
   } catch (err) {
    logger.error(
      {
        err: err.message,
        stack: err.stack,
        code: err.code,
        command: interaction.commandName ?? interaction.customId,
        discordId,
      },
      'Interaction handler failed'
    );

    const isOperational = err.isOperational === true;

    // Report unexpected (non-operational) errors to the audit channel.
    if (!isOperational && interaction.client) {
      const { reportError } = await import('./utils/errorReporter.js');
      await reportError(interaction.client, err, {
        source: 'interaction',
        command: interaction.commandName,
        customId: interaction.customId,
        userId: discordId,
      });
    }

    const description = isOperational
      ? err.message
      : 'An unexpected error occurred. Please try again or contact an administrator.';

    await safeReply(interaction, errorEmbed({
      title: 'Command Failed',
      description,
    }));
  }
}

/**
 * Reply safely, whether the interaction has been deferred, replied,
 * or is fresh. Uses ephemeral only when appropriate.
 */
async function safeReply(interaction, embed) {
  try {
    const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
    } else if (interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    // Last resort: swallow. Avoid crashing on already-acknowledged interactions.
    logger.debug({ err: err.message }, 'safeReply failed');
  }
}

/** Test-only: clear cooldown state. */
export function _resetCooldowns() {
  cooldowns.clear();
}

/** Test-only: read cooldown state. */
export function _getCooldowns() {
  return cooldowns;
}
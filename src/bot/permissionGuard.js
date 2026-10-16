// src/bot/permissionGuard.js

import { MessageFlags } from 'discord.js';
import * as userRepo from '../db/repositories/user.repository.js';
import * as permissionService from '../services/permission.service.js';
import { errorEmbed } from './embedBuilders.js';
import logger from '../config/logger.js';

const cooldowns = new Map();
const MAX_COOLDOWN_MS = 60 * 1000;

export async function guard(interaction, meta, handler) {
  const discordId = interaction.user?.id;
  if (!discordId) {
    await safeReply(interaction, errorEmbed({
      title: 'Interaction Error',
      description: 'Could not identify your Discord account.',
    }));
    return;
  }

  let user = await userRepo.findByDiscordId(discordId);

  // Auto-create a User row on first interaction.
  if (!user) {
    try {
      user = await userRepo.create({
        discordId,
        discordUsername: interaction.user.username,
        status: 'UNVERIFIED',
      });
      logger.info(
        { discordId, username: interaction.user.username },
        'Auto-created User row'
      );
    } catch (err) {
      user = await userRepo.findByDiscordId(discordId);
      if (!user) {
        logger.warn(
          { err: err.message, discordId },
          'Could not auto-create user row'
        );
      }
    }
  }

  if (meta?.requireLinked && (!user || !user.roblox_id)) {
    await safeReply(interaction, errorEmbed({
      title: 'Account Not Linked',
      description: 'You must link your Roblox account first. Use `/link <roblox_username>` to begin.',
    }));
    return;
  }

  if (user && user.status === 'SUSPENDED') {
    await safeReply(interaction, errorEmbed({
      title: 'Account Suspended',
      description: 'Your account is currently suspended. Contact High Command if you believe this is an error.',
    }));
    return;
  }

  // ------------------------------------------------------------------
  // Resolve the user's effective permissions ONCE per interaction.
  // The `permissions` Set is shared with every downstream handler via ctx.
  // ------------------------------------------------------------------
  let permissions = new Set();
  if (user) {
    try {
      permissions = await permissionService.getEffectivePermissions(user.id);
    } catch (err) {
      logger.warn(
        { err: err.message, discordId },
        'Could not resolve effective permissions — falling back to empty set'
      );
    }
  }

  // Legacy meta.permission check (still supported).
  if (meta?.permission) {
    if (!user || !permissions.has(meta.permission)) {
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
        description: 'Please wait ' + secs + 's before running this command again.',
      }));
      return;
    }
    userCooldowns.set(key, Date.now());
    cooldowns.set(discordId, userCooldowns);
  }

  try {
    await handler({
      user,
      permissions,
      hasPermission: (key) => permissions.has(key),
    });
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
    logger.debug({ err: err.message }, 'safeReply failed');
  }
}

export function _resetCooldowns() {
  cooldowns.clear();
}

export function _getCooldowns() {
  return cooldowns;
}
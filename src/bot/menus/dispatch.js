// src/bot/menus/dispatch.js

import { MessageFlags } from 'discord.js';
import { buildModal } from './modals.js';
import { errorEmbed } from '../embedBuilders.js';

/**
 * Dispatch a chosen menu action.
 */
export async function dispatch(interaction, action, ctx) {
  switch (action.mode) {
    case 'modal':
      return showModalFor(interaction, action);
    case 'route':
      return routeToHandler(interaction, action, ctx);
    case 'direct':
      return runDirect(interaction, action, ctx);
    default:
      return ephemeralError(interaction, 'Unsupported action mode: ' + action.mode);
  }
}

async function showModalFor(interaction, action) {
  try {
    const modal = buildModal(action.target);
    return interaction.showModal(modal);
  } catch (err) {
    return ephemeralError(interaction, 'Could not open modal: ' + err.message);
  }
}

async function routeToHandler(interaction, action, ctx) {
  let handlers;
  try {
    handlers = await loadHandlers(action.module);
  } catch (err) {
    return ephemeralError(interaction, 'Handler module not found: ' + action.module);
  }

  const handler = handlers[action.fn];
  if (typeof handler !== 'function') {
    return ephemeralError(interaction, 'Handler not found: ' + action.module + '.' + action.fn);
  }

  return handler(interaction, ctx);
}

function runDirect(interaction, action, ctx) {
  return ephemeralError(interaction, 'Direct actions are not implemented yet.');
}

// ------------------------------------------------------------------
//  Handler loader — supports BOTH layouts:
//
//   1. src/bot/commands/<module>/handlers.js   (used by /event)
//   2. src/bot/commands/<module>.js            (used by all others,
//                                               via a HANDLERS export)
// ------------------------------------------------------------------

const handlerCache = new Map();

async function loadHandlers(moduleKey) {
  if (handlerCache.has(moduleKey)) return handlerCache.get(moduleKey);

  // Try folder layout first.
  try {
    const mod = await import('../commands/' + moduleKey + '/handlers.js');
    if (mod && mod.HANDLERS) {
      handlerCache.set(moduleKey, mod.HANDLERS);
      return mod.HANDLERS;
    }
  } catch {
    // fall through
  }

  // Fall back to single-file module.
  const mod = await import('../commands/' + moduleKey + '.js');
  if (!mod || !mod.HANDLERS) {
    throw new Error('No HANDLERS export for ' + moduleKey);
  }
  handlerCache.set(moduleKey, mod.HANDLERS);
  return mod.HANDLERS;
}

async function ephemeralError(interaction, message) {
  const payload = {
    embeds: [errorEmbed({ title: 'Error', description: message })],
    flags: MessageFlags.Ephemeral,
  };
  try {
    if (interaction.deferred && !interaction.replied) return interaction.editReply(payload);
    if (interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
  } catch {
    return null;
  }
}
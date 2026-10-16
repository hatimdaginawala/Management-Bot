import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import logger from '../config/logger.js';

/**
 * Interaction router.
 *
 * Registers button, modal, and select-menu handlers from their
 * respective folders. Handlers use a `customId` field that may be:
 *
 *   - exact:  "event:approve:12345"
 *   - prefix: "event:approve:*" (matches any customId starting with
 *             "event:approve:")
 *
 * Lookup order:
 *   1. Exact match.
 *   2. Prefix match (longest wins).
 *
 * Multiple handlers with the same customId are a configuration error
 * and are logged at load time.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUTTONS_DIR = join(__dirname, 'buttons');
const MODALS_DIR = join(__dirname, 'modals');
const SELECTS_DIR = join(__dirname, 'selectMenus');

const registry = {
  buttons: new Map(),
  modals: new Map(),
  selects: new Map(),
};

let loaded = false;

export async function loadInteractionHandlers() {
  if (loaded) return;
  await Promise.all([
    loadDir(BUTTONS_DIR, 'buttons'),
    loadDir(MODALS_DIR, 'modals'),
    loadDir(SELECTS_DIR, 'selects'),
  ]);
  loaded = true;
  logger.info(
    {
      buttons: registry.buttons.size,
      modals: registry.modals.size,
      selects: registry.selects.size,
    },
    'Interaction handlers loaded'
  );
}

async function loadDir(dir, bucket) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // folder may not exist yet
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const url = pathToFileURL(join(dir, entry.name)).href;
    let mod;
    try {
      mod = await import(url);
    } catch (err) {
      logger.error({ file: entry.name, err: err.message }, 'Failed to import handler');
      continue;
    }
   const rawCustomId = mod.customId;
if (!rawCustomId) {
  logger.warn({ file: entry.name }, 'Skipping handler without customId');
  continue;
}
if (typeof mod.execute !== 'function') {
  logger.warn({ file: entry.name }, 'Skipping handler without execute()');
  continue;
}
const customIds = Array.isArray(rawCustomId) ? rawCustomId : [rawCustomId];
for (const customId of customIds) {
  if (registry[bucket].has(customId)) {
    logger.warn(
      { customId, bucket, file: entry.name },
      'Duplicate customId — keeping first registration'
    );
    continue;
  }
  registry[bucket].set(customId, mod);
}}
}

// ============================================================
//  Dispatch
// ============================================================

export function findButton(customId) {
  return findIn(registry.buttons, customId);
}

export function findModal(customId) {
  return findIn(registry.modals, customId);
}

export function findSelect(customId) {
  return findIn(registry.selects, customId);
}

function findIn(map, customId) {
  // 1. Exact match.
  if (map.has(customId)) return map.get(customId);

  // 2. Segment-based wildcard match.
  //    A registered key with `*` segments matches an incoming customId
  //    if both have the same number of `:`-separated segments and every
  //    non-`*` segment matches exactly. Longest (most specific) wins.
  const incoming = customId.split(':');
  let bestMatch = null;
  let bestScore = -1;

  for (const [key, mod] of map.entries()) {
    if (!key.includes('*')) continue;
    const pattern = key.split(':');
    if (pattern.length !== incoming.length) continue;

    let ok = true;
    let wildcards = 0;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === '*') { wildcards++; continue; }
      if (pattern[i] !== incoming[i]) { ok = false; break; }
    }
    if (!ok) continue;

    // Prefer the pattern with fewer wildcards (more specific).
    const score = pattern.length - wildcards;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = mod;
    }
  }

  return bestMatch;
}

/** Test-only. */
export function _getRegistry() {
  return registry;
}

/** Test-only. */
export function _clearRegistry() {
  registry.buttons.clear();
  registry.modals.clear();
  registry.selects.clear();
  loaded = false;
}
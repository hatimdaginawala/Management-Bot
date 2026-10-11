import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import logger from '../config/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = join(__dirname, 'commands');

const commands = new Map();
let loaded = false;

/**
 * Load every command module under src/bot/commands/, recursively.
 * Each module must export:
 *   - data      (SlashCommandBuilder.toJSON())
 *   - execute   (async (interaction, ctx) => {})
 *
 * Optional exports:
 *   - meta      ({ permission, requireLinked, cooldownSeconds })
 */
export async function loadCommands() {
  if (loaded) return commands;
  await walk(COMMANDS_DIR);
  loaded = true;
  logger.info({ count: commands.size }, 'Slash commands loaded');
  return commands;
}

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      await loadFile(fullPath);
    }
  }
}

async function loadFile(fullPath) {
  let mod;
  try {
    mod = await import(pathToFileURL(fullPath).href);
  } catch (err) {
    logger.error(
      { file: fullPath, err: err.message, stack: err.stack },
      'Failed to import command module'
    );
    return;
  }

  if (!mod.data || typeof mod.execute !== 'function') {
    // Not a top-level command. Sub-handlers (imported by dispatchers
    // like event/create.js) live in the same folder but don't export
    // `data`/`execute`. Skip silently.
    logger.debug({ file: fullPath }, 'Skipping non-command module');
    return;
  }

  const name = mod.data.name;
  if (!name) {
    logger.warn({ file: fullPath }, 'Command module has no name in data — skipping');
    return;
  }

  if (commands.has(name)) {
    logger.warn({ name, file: fullPath }, 'Duplicate command name — keeping first');
    return;
  }

  commands.set(name, {
    data: mod.data,
    meta: mod.meta ?? {},
    execute: mod.execute,
    filePath: fullPath,
  });
}

export function getCommand(name) {
  return commands.get(name);
}

export function listCommands() {
  return Array.from(commands.values());
}

/** Test-only. */
export function _clearCommands() {
  commands.clear();
  loaded = false;
}
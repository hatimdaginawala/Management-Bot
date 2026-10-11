import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import logger from '../../config/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadEventHandlers(client) {
  const files = (await readdir(__dirname)).filter(
    (f) => f.endsWith('.js') && f !== 'index.js'
  );

  for (const file of files) {
    const url = pathToFileURL(join(__dirname, file)).href;
    const mod = await import(url);

    if (!mod.name || typeof mod.execute !== 'function') {
      logger.warn({ file }, 'Skipping invalid event handler module');
      continue;
    }

    if (mod.once) {
      client.once(mod.name, (...args) => mod.execute(...args));
    } else {
      client.on(mod.name, (...args) => mod.execute(...args));
    }

    logger.debug({ event: mod.name, file }, 'Event handler loaded');
  }

  logger.info({ count: files.length }, 'Event handlers loaded');
}
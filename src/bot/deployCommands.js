import { REST, Routes } from 'discord.js';
import { fileURLToPath } from 'node:url';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { loadCommands } from './commandLoader.js';

/**
 * Register all loaded slash commands with the configured guild.
 * Command modules are discovered by commandLoader.loadCommands().
 *
 * Run via:  npm run deploy:commands
 */
export async function deployCommands() {
  await loadCommands();
  const commands = await import('./commandLoader.js').then((m) => m.listCommands());

  if (commands.length === 0) {
    logger.info('No slash commands found. Nothing to deploy.');
    return [];
  }

  const body = commands.map((c) => c.data);
  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  logger.info(
    { count: body.length, guildId: config.discord.guildId },
    'Registering slash commands'
  );

  const data = await rest.put(
    Routes.applicationGuildCommands(
      config.discord.clientId,
      config.discord.guildId
    ),
    { body }
  );

  logger.info({ count: data.length }, 'Slash commands registered');
  return data;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  deployCommands()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err: err.message, stack: err.stack }, 'Deploy failed');
      process.exit(1);
    });
}
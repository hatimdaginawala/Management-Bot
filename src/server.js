import http from 'node:http';

import config from './config/index.js';
import logger from './config/logger.js';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './db/client.js';
import { createDiscordClient } from './bot/client.js';
import { loadEventHandlers } from './bot/eventHandlers/index.js';
import { startScheduler, stopScheduler } from './jobs/runner.js';

async function bootstrap() {
  logger.info({ env: config.env }, 'Starting 24th Guard Rifles Management Bot');

  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => {
      logger.info({ port: config.port }, 'HTTP server listening');
      resolve();
    });
  });

  const client = createDiscordClient();
  await loadEventHandlers(client);

  client.login(config.discord.token).catch((err) => {
    logger.error(
      { err: err.message },
      'Discord login failed. HTTP server remains up.'
    );
  });

  startScheduler({ client });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutdown initiated');

    const timeout = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000);
    timeout.unref();

    try {
      stopScheduler();

      await new Promise((resolve) => server.close(resolve));
      logger.info('HTTP server closed');

      if (client.isReady()) {
        await client.destroy();
        logger.info('Discord client destroyed');
      }

      await disconnectDatabase();

      clearTimeout(timeout);
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err: err.message }, 'Error during shutdown');
      process.exit(1);
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err: err.message, stack: err.stack }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
import http from 'node:http';
import mongoose from 'mongoose';
import config from './config/index.js';
import logger from './config/logger.js';
import { createApp } from './app.js';
import { startScheduler, stopScheduler } from './jobs/runner.js';
import {
  connectDatabase,
  disconnectDatabase,
} from './config/database.js';

import { createDiscordClient } from './bot/client.js';
import { loadEventHandlers } from './bot/eventHandlers/index.js';
import './models/index.js';
async function bootstrap() {
  logger.info({ env: config.env }, 'Starting 24th Guard Rifles Management Bot');

  // 1. Database
  await connectDatabase();
  logger.info(
  { models: mongoose.modelNames() },
  'Mongoose models registered'
);

  // 2. Express
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => {
      logger.info({ port: config.port }, 'HTTP server listening');
      resolve();
    });
  });

  // 3. Discord
  const client = createDiscordClient();
  await loadEventHandlers(client);

  client.login(config.discord.token).catch((err) => {
    logger.error(
      { err: err.message },
      'Discord login failed. HTTP server remains up.'
    );
  });
    // 5. Start the scheduler (cron jobs).
  startScheduler({ client });

  // 4. Graceful shutdown
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
      await new Promise((resolve) => server.close(resolve));
      logger.info('HTTP server closed');

      if (client.isReady()) {
        await client.destroy();
        logger.info('Discord client destroyed');
      }
      stopScheduler();
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
  // Logger may not be fully configured; fall back to console.
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
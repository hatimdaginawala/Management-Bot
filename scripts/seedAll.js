import { connectDatabase, disconnectDatabase } from '../src/db/client.js';
import logger from '../src/config/logger.js';

import { seedPermissions } from './seedPermissions.js';
import { seedRoles } from './seedRoles.js';
import { seedEventTypes } from './seedEventTypes.js';
import { seedSettings } from './seedSettings.js';

async function main() {
  const started = Date.now();
  logger.info('Seed run starting');

  await connectDatabase();

  // Order matters: permissions first (roles reference permission keys),
  // then roles, event types, settings.
  await seedPermissions();
  await seedRoles();
  await seedEventTypes();
  await seedSettings();

  const ms = Date.now() - started;
  logger.info({ ms }, 'Seed run complete');

  await disconnectDatabase();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err: err.message, stack: err.stack }, 'Seed run failed');
    process.exit(1);
  });
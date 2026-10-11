import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import logger from '../src/config/logger.js';

// Register all Mongoose models before seeds run.
import '../src/models/index.js';

import { seedPermissions } from './seedPermissions.js';
import { seedRoles } from './seedRoles.js';
import { seedEventTypes } from './seedEventTypes.js';
import { seedSettings } from './seedSettings.js';

async function main() {
  const started = Date.now();
  logger.info('Seed run starting');

  await connectDatabase();

  // Order matters: roles reference permission keys, so permissions
  // should exist first for any downstream UI to render. Settings has
  // no dependencies but is seeded last so it can optionally read
  // freshly seeded data in future phases.
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
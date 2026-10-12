import { connectDatabase, disconnectDatabase } from '../src/db/client.js';
import logger from '../src/config/logger.js';

import { seedPermissions } from './seedPermissions.js';
import { seedRoles } from './seedRoles.js';
import { seedEventTypes } from './seedEventTypes.js';
import { seedSettings } from './seedSettings.js';
import { seedBootstrapUser } from './seedBootstrapUser.js';

async function main() {
  const started = Date.now();
  logger.info('Seed run starting');

  await connectDatabase();

  // Order matters:
  //   1. Permissions first — roles reference permission keys
  //   2. Roles next       — bootstrap user needs super_admin
  //   3. Event types
  //   4. Settings
  //   5. Bootstrap user   — creates the operator + assigns super_admin
  await seedPermissions();
  await seedRoles();
  await seedEventTypes();
  await seedSettings();
  await seedBootstrapUser();

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
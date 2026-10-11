import { Settings } from '../src/models/index.js';
import { DEFAULT_SETTINGS } from '../src/constants/settings.js';
import config from '../src/config/index.js';
import logger from '../src/config/logger.js';

/**
 * Idempotent settings seed.
 *
 * Uses `$setOnInsert` so an existing Settings document is NEVER
 * overwritten. Missing fields on an existing document are also not
 * filled — a settings migration, if ever needed, must be explicit.
 *
 * On first run, seeds from DEFAULT_SETTINGS and then overlays the
 * Roblox group ID from the environment (so ops config lives in .env,
 * not in code).
 */
export async function seedSettings() {
  const seed = structuredClone(DEFAULT_SETTINGS);
  // Env-provided group ID overrides the placeholder.
  seed.roblox.groupId = config.roblox.groupId;

  // `$setOnInsert` only applies to the fields present in this object.
  // Nested objects are treated as whole values: any missing nested field
  // will be filled from seed on insert.
  const result = await Settings.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: seed },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const created = result.createdAt?.getTime() === result.updatedAt?.getTime();
  logger.info(
    { created, key: result.key, groupId: result.roblox?.groupId },
    'Settings seeded'
  );
  return result;
}
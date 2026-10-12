import * as settingsRepo from '../src/db/repositories/settings.repository.js';
import { DEFAULT_SETTINGS } from '../src/constants/settings.js';
import config from '../src/config/index.js';
import logger from '../src/config/logger.js';

/**
 * Idempotent settings seed.
 *
 * Uses ensureExists (insert-if-not-present) on every setting key, so
 * re-running the seed NEVER overwrites live values. Missing keys are
 * filled in.
 *
 * On first run, seeds from DEFAULT_SETTINGS plus the Roblox group ID
 * from the environment.
 */

function flattenSettings(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenSettings(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function inferType(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'json';
}

export async function seedSettings() {
  const seed = structuredClone(DEFAULT_SETTINGS);
  seed.roblox = seed.roblox || {};
  seed.roblox.groupId = config.roblox.groupId;

  // Drop top-level bookkeeping fields that aren't real settings.
  delete seed.key;

  const flat = flattenSettings(seed);

  let inserted = 0;
  let skipped = 0;

  for (const [settingKey, value] of Object.entries(flat)) {
    const group = settingKey.split('.')[0];
    const valueType = inferType(value);

    const existing = await settingsRepo.findByKey(settingKey);
    if (existing) {
      skipped++;
      continue;
    }

    await settingsRepo.ensureExists(settingKey, group, value, valueType, {
      updatedBy: 'system',
    });
    inserted++;
  }

  logger.info(
    { inserted, skipped, total: Object.keys(flat).length },
    'Settings seeded'
  );
  return { inserted, skipped };
}
import * as permissionRepo from '../src/db/repositories/permission.repository.js';
import { PERMISSIONS } from '../src/constants/permissions.js';
import logger from '../src/config/logger.js';

/**
 * Idempotent permission seed.
 *
 * For each permission in the canonical catalog:
 *   - If missing  -> insert.
 *   - If present  -> update label/description/category in place.
 *                     (Keys are stable; metadata may evolve.)
 *
 * Permissions removed from the catalog are NOT deleted here.
 */
export async function seedPermissions() {
  let inserted = 0;
  let updated = 0;

  for (const perm of PERMISSIONS) {
    const existing = await permissionRepo.findByKey(perm.key);

    if (!existing) {
      await permissionRepo.upsert({
        key: perm.key,
        label: perm.label,
        description: perm.description ?? '',
        category: perm.category,
        isWildcard: false,
      });
      inserted++;
    } else {
      const needsUpdate =
        existing.label !== perm.label ||
        existing.description !== (perm.description ?? '') ||
        existing.category !== perm.category;

      if (needsUpdate) {
        await permissionRepo.upsert({
          key: perm.key,
          label: perm.label,
          description: perm.description ?? '',
          category: perm.category,
          isWildcard: false,
        });
        updated++;
      }
    }
  }

  logger.info({ inserted, updated, total: PERMISSIONS.length }, 'Permissions seeded');
  return { inserted, updated };
}
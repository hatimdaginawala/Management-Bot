import * as roleRepo from '../src/db/repositories/role.repository.js';
import { SYSTEM_ROLE_SEEDS } from '../src/constants/roles.js';
import logger from '../src/config/logger.js';

/**
 * Idempotent role seed.
 *
 * Insert-only: if a role with the given key already exists, it is
 * skipped entirely. This preserves admin edits to system roles.
 */
export async function seedRoles() {
  let inserted = 0;
  let skipped = 0;

  for (const seed of SYSTEM_ROLE_SEEDS) {
    const existing = await roleRepo.findByKey(seed.key);

    if (existing) {
      skipped++;
      continue;
    }

    await roleRepo.create({
      key: seed.key,
      name: seed.name,
      description: seed.description,
      permissions: seed.permissions,
      priority: seed.priority,
      quotaCategory: seed.quotaCategory,
      kind: seed.kind,
      isPermanent: seed.isPermanent,
      isEditable: seed.isEditable,
      isDeletable: seed.isDeletable,
      active: seed.active,
      createdBy: 'system',
    });
    inserted++;
  }

  logger.info(
    { inserted, skipped, total: SYSTEM_ROLE_SEEDS.length },
    'Roles seeded'
  );
  return { inserted, skipped };
}
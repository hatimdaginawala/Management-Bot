import { Role } from '../src/models/index.js';
import { SYSTEM_ROLE_SEEDS } from '../src/constants/roles.js';
import logger from '../src/config/logger.js';

/**
 * Idempotent role seed.
 *
 * For each system role:
 *   - If missing  -> insert with seed permissions, priority, flags.
 *   - If present  -> do NOT overwrite permissions or priority.
 *                     System roles are editable by admins; auto-overwriting
 *                     on every deploy would silently discard their edits.
 *
 * This is a deliberate change from a naive "upsert":
 *   The seed only ensures the row EXISTS. It never mutates a live role.
 *
 * To force-reset a role to seed defaults, delete the row and re-run
 * the seed. That operation is audited (see Phase 16).
 */
export async function seedRoles() {
  let inserted = 0;
  let skipped = 0;

  for (const seed of SYSTEM_ROLE_SEEDS) {
    const existing = await Role.findOne({ key: seed.key });

    if (existing) {
      skipped++;
      continue;
    }

    await Role.create({
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
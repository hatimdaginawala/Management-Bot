import { EventType } from '../src/models/index.js';
import { EVENT_TYPE_SEEDS } from '../src/constants/eventTypes.js';
import logger from '../src/config/logger.js';

/**
 * Idempotent event-type seed.
 * Same policy as roles: insert-only, never overwrite admin edits.
 */
export async function seedEventTypes() {
  let inserted = 0;
  let skipped = 0;

  for (const seed of EVENT_TYPE_SEEDS) {
    const existing = await EventType.findOne({ key: seed.key });
    if (existing) {
      skipped++;
      continue;
    }
    await EventType.create({
      key: seed.key,
      name: seed.name,
      description: seed.description ?? '',
      countsForQuota: true,
      active: true,
      sortOrder: seed.sortOrder ?? 0,
      createdBy: 'system',
      isDeletable: false, // seeded types are protected from deletion
    });
    inserted++;
  }

  logger.info(
    { inserted, skipped, total: EVENT_TYPE_SEEDS.length },
    'Event types seeded'
  );
  return { inserted, skipped };
}
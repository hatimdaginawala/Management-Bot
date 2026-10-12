import * as eventTypeRepo from '../src/db/repositories/eventType.repository.js';
import { EVENT_TYPE_SEEDS } from '../src/constants/eventTypes.js';
import logger from '../src/config/logger.js';

/**
 * Idempotent event-type seed. Insert-only.
 */
export async function seedEventTypes() {
  let inserted = 0;
  let skipped = 0;

  for (const seed of EVENT_TYPE_SEEDS) {
    const existing = await eventTypeRepo.findByKey(seed.key);
    if (existing) {
      skipped++;
      continue;
    }

    await eventTypeRepo.create({
      key: seed.key,
      name: seed.name,
      description: seed.description ?? '',
      countsForQuota: true,
      active: true,
      sortOrder: seed.sortOrder ?? 0,
      createdBy: 'system',
      isDeletable: false,
    });
    inserted++;
  }

  logger.info(
    { inserted, skipped, total: EVENT_TYPE_SEEDS.length },
    'Event types seeded'
  );
  return { inserted, skipped };
}
import * as eventTypeRepo from '../db/repositories/eventType.repository.js';
import { audit } from '../utils/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Event type service. Public API unchanged from the Mongoose version.
 */

export async function listEventTypes({ includeInactive = false } = {}) {
  return eventTypeRepo.list({ includeInactive });
}

export async function getEventTypeByKey(key) {
  const et = await eventTypeRepo.findByKey(key);
  if (!et) throw new NotFoundError('Event type', { key });
  return et;
}

export async function createEventType(actorId, {
  key,
  name,
  description = '',
  sortOrder = 0,
  countsForQuota = true,
}) {
  if (!key || !/^[a-z][a-z0-9_]{1,40}$/.test(key)) {
    throw new ValidationError(
      'Event type key must be lowercase, start with a letter, 2–41 chars.'
    );
  }
  if (!name || name.length > 60) {
    throw new ValidationError('Event type name is required and ≤ 60 chars.');
  }

  const existing = await eventTypeRepo.findByKey(key);
  if (existing) throw new ConflictError('Event type "' + key + '" already exists.');

  const et = await eventTypeRepo.create({
    key: key.toLowerCase(),
    name,
    description,
    sortOrder,
    countsForQuota,
    active: true,
    createdBy: actorId,
    isDeletable: true,
  });

  await audit({
    actorId,
    action: 'eventType.created',
    category: 'EVENT',
    targetType: 'EventType',
    targetId: et.id,
    after: et,
  });
  return et;
}

export async function editEventType(actorId, key, patch) {
  const et = await eventTypeRepo.findByKey(key);
  if (!et) throw new NotFoundError('Event type', { key });

  if (!et.is_deletable) {
    const allowed = ['active', 'sortOrder'];
    for (const k of Object.keys(patch)) {
      if (!allowed.includes(k)) {
        throw new ValidationError(
          'Seeded event type "' + et.key + '" cannot change field "' + k + '".'
        );
      }
    }
  }

  const before = { ...et };

  // Map camelCase patch keys to repository fields
  const repoPatch = {};
  for (const k of ['name', 'description', 'sortOrder', 'countsForQuota', 'active']) {
    if (patch[k] !== undefined) repoPatch[k] = patch[k];
  }

  const updated = await eventTypeRepo.updateById(et.id, repoPatch);

  await audit({
    actorId,
    action: 'eventType.edited',
    category: 'EVENT',
    targetType: 'EventType',
    targetId: et.id,
    before,
    after: updated,
  });
  return updated;
}

export async function disableEventType(actorId, key, { reason = null } = {}) {
  const et = await eventTypeRepo.findByKey(key);
  if (!et) throw new NotFoundError('Event type', { key });

  const updated = await eventTypeRepo.updateById(et.id, { active: false });

  await audit({
    actorId,
    action: 'eventType.disabled',
    category: 'EVENT',
    targetType: 'EventType',
    targetId: et.id,
    before: { active: true },
    after: { active: false },
    reason,
  });
  return updated;
}

export async function activeEventTypeKeys() {
  return eventTypeRepo.listActiveKeys();
}
import { EventType } from '../models/index.js';
import { audit } from '../utils/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Event type service. Backs /event-types and the select menus in /event create.
 * Seeded at install; High Command may add/disable types.
 */

export async function listEventTypes({ includeInactive = false } = {}) {
  const filter = includeInactive ? {} : { active: true };
  return EventType.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
}

export async function getEventTypeByKey(key) {
  const et = await EventType.findOne({ key: key.toLowerCase() }).lean();
  if (!et) throw new NotFoundError('Event type', { key });
  return et;
}

export async function createEventType(actorId, { key, name, description = '', sortOrder = 0, countsForQuota = true }) {
  if (!key || !/^[a-z][a-z0-9_]{1,40}$/.test(key)) {
    throw new ValidationError('Event type key must be lowercase, start with a letter, 2–41 chars.');
  }
  if (!name || name.length > 60) {
    throw new ValidationError('Event type name is required and ≤ 60 chars.');
  }

  const existing = await EventType.findOne({ key: key.toLowerCase() });
  if (existing) throw new ConflictError(`Event type "${key}" already exists.`);

  const et = await EventType.create({
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
    targetId: et._id,
    after: et.toObject(),
  });
  return et;
}

export async function editEventType(actorId, key, patch) {
  const et = await EventType.findOne({ key: key.toLowerCase() });
  if (!et) throw new NotFoundError('Event type', { key });
  if (!et.isDeletable) {
    // Seeded types are protected from structural edits; you may still toggle `active`.
    const allowed = ['active', 'sortOrder'];
    for (const k of Object.keys(patch)) {
      if (!allowed.includes(k)) {
        throw new ValidationError(`Seeded event type "${et.key}" cannot change field "${k}".`);
      }
    }
  }

  const before = et.toObject();
  for (const k of ['name', 'description', 'sortOrder', 'countsForQuota', 'active']) {
    if (patch[k] !== undefined) et[k] = patch[k];
  }
  await et.save();

  await audit({
    actorId,
    action: 'eventType.edited',
    category: 'EVENT',
    targetType: 'EventType',
    targetId: et._id,
    before,
    after: et.toObject(),
  });
  return et;
}

export async function disableEventType(actorId, key, { reason = null } = {}) {
  const et = await EventType.findOne({ key: key.toLowerCase() });
  if (!et) throw new NotFoundError('Event type', { key });
  et.active = false;
  await et.save();

  await audit({
    actorId,
    action: 'eventType.disabled',
    category: 'EVENT',
    targetType: 'EventType',
    targetId: et._id,
    before: { active: true },
    after: { active: false },
    reason,
  });
  return et;
}

export async function activeEventTypeKeys() {
  const types = await EventType.find({ active: true }).select('key').lean();
  return types.map((t) => t.key);
}
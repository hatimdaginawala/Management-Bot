import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const BOOLEAN_FIELDS = ['is_verified'];
const CTX = { repository: 'eventAttendee' };

export async function listByEvent(eventId) {
  return withDbErrors(async () => {
    const rows = await db('event_attendees')
      .where({ event_id: eventId })
      .orderBy('id', 'asc');
    return convertRows(rows, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'listByEvent' });
}

/**
 * Bulk insert attendee entries for one event.
 * Called when an event is created or edited.
 */
export async function insertMany(eventId, entries) {
  if (!entries || entries.length === 0) return [];
  return withDbErrors(async () => {
    const rows = entries.map((e) => ({
      event_id: eventId,
      discord_id: e.discordId ?? null,
      roblox_username: e.robloxUsername ?? null,
      resolved_user_id: e.resolvedUserId ?? null,
      is_verified: e.isVerified ?? false,
    }));
    await db('event_attendees').insert(rows);
    return listByEvent(eventId);
  }, { ...CTX, method: 'insertMany' });
}

/**
 * Delete all attendees for an event.
 * Called before re-inserting on an event edit.
 */
export async function deleteByEvent(eventId) {
  return withDbErrors(async () => {
    return db('event_attendees').where({ event_id: eventId }).delete();
  }, { ...CTX, method: 'deleteByEvent' });
}

/**
 * Replace attendee entries for an event atomically.
 * Used by updateEvent.
 *
 * Note: MySQL DDL/DML is transactional for InnoDB, so a service can wrap
 * this in a transaction. Without a transaction, the delete and insert
 * happen as two separate statements — acceptable for our usage, since
 * event edits are rare and low-concurrency.
 */
export async function replaceForEvent(eventId, entries) {
  return withDbErrors(async () => {
    await db('event_attendees').where({ event_id: eventId }).delete();
    if (entries.length > 0) {
      const rows = entries.map((e) => ({
        event_id: eventId,
        discord_id: e.discordId ?? null,
        roblox_username: e.robloxUsername ?? null,
        resolved_user_id: e.resolvedUserId ?? null,
        is_verified: e.isVerified ?? false,
      }));
      await db('event_attendees').insert(rows);
    }
    return listByEvent(eventId);
  }, { ...CTX, method: 'replaceForEvent' });
}
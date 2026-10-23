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

export async function insertMany(eventId, entries, trx = db) {
  if (!entries || entries.length === 0) return [];
  return withDbErrors(async () => {
    const rows = entries.map((e) => ({
      event_id: eventId,
      discord_id: e.discordId ?? null,
      roblox_username: e.robloxUsername ?? null,
      resolved_user_id: e.resolvedUserId ?? null,
      is_verified: e.isVerified ?? false,
    }));
    await trx('event_attendees').insert(rows);
    const list = await trx('event_attendees')
      .where({ event_id: eventId })
      .orderBy('id', 'asc');
    return convertRows(list, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'insertMany' });
}

export async function deleteByEvent(eventId, trx = db) {
  return withDbErrors(async () => {
    return trx('event_attendees').where({ event_id: eventId }).delete();
  }, { ...CTX, method: 'deleteByEvent' });
}

export async function replaceForEvent(eventId, entries, trx = db) {
  return withDbErrors(async () => {
    await trx('event_attendees').where({ event_id: eventId }).delete();
    if (entries.length > 0) {
      const rows = entries.map((e) => ({
        event_id: eventId,
        discord_id: e.discordId ?? null,
        roblox_username: e.robloxUsername ?? null,
        resolved_user_id: e.resolvedUserId ?? null,
        is_verified: e.isVerified ?? false,
      }));
      await trx('event_attendees').insert(rows);
    }
    const list = await trx('event_attendees')
      .where({ event_id: eventId })
      .orderBy('id', 'asc');
    return convertRows(list, { booleanFields: BOOLEAN_FIELDS });
  }, { ...CTX, method: 'replaceForEvent' });
}
import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const CTX = { repository: 'settings' };

/**
 * Settings are stored as key-value rows.
 *
 * `value_json` holds a JSON-serialized value; `value_type` tells us
 * how to coerce it back to a JS value on read.
 */

/**
 * Read a single setting by dotted path.
 * Returns { value, type, description, updatedBy, updatedAt } or null.
 */
export async function findByKey(settingKey) {
  return withDbErrors(async () => {
    const row = await db('settings').where({ setting_key: settingKey }).first();
    return convertRow(row);
  }, { ...CTX, method: 'findByKey' });
}

/**
 * Read all settings. Returns an array of rows.
 */
export async function listAll() {
  return withDbErrors(async () => {
    const rows = await db('settings').orderBy('setting_key', 'asc');
    return convertRows(rows);
  }, { ...CTX, method: 'listAll' });
}

/**
 * Read all settings in a group (e.g. "events").
 */
export async function listByGroup(group) {
  return withDbErrors(async () => {
    const rows = await db('settings')
      .where({ setting_group: group })
      .orderBy('setting_key', 'asc');
    return convertRows(rows);
  }, { ...CTX, method: 'listByGroup' });
}

/**
 * Upsert a setting row.
 * Called by setSetting() and by seedSettings on first install.
 *
 * @param {string} settingKey   e.g. "events.cooldownMinutes"
 * @param {string} group        e.g. "events"
 * @param {*}      value        JS value
 * @param {string} valueType    'string' | 'number' | 'boolean' | 'null' | 'json'
 * @param {object} opts         { description, updatedBy }
 */
export async function upsert(settingKey, group, value, valueType, opts = {}) {
  return withDbErrors(async () => {
    const serialized = JSON.stringify(value ?? null);

    const existing = await db('settings').where({ setting_key: settingKey }).first();
    if (!existing) {
      await db('settings').insert({
        setting_key: settingKey,
        setting_group: group,
        value_type: valueType,
        value_json: serialized,
        description: opts.description ?? null,
        last_updated_by: opts.updatedBy ?? 'system',
        last_updated_at: new Date(),
      });
    } else {
      await db('settings').where({ setting_key: settingKey }).update({
        value_type: valueType,
        value_json: serialized,
        last_updated_by: opts.updatedBy ?? existing.last_updated_by,
        last_updated_at: new Date(),
      });
    }
    const row = await db('settings').where({ setting_key: settingKey }).first();
    return convertRow(row);
  }, { ...CTX, method: 'upsert' });
}

/**
 * Insert-only upsert (used by seedSettings on first install).
 * Does NOT overwrite an existing row.
 */
export async function ensureExists(settingKey, group, value, valueType, opts = {}) {
  return withDbErrors(async () => {
    const existing = await db('settings').where({ setting_key: settingKey }).first();
    if (existing) return convertRow(existing);
    await db('settings').insert({
      setting_key: settingKey,
      setting_group: group,
      value_type: valueType,
      value_json: JSON.stringify(value ?? null),
      description: opts.description ?? null,
      last_updated_by: opts.updatedBy ?? 'system',
      last_updated_at: new Date(),
    });
    const row = await db('settings').where({ setting_key: settingKey }).first();
    return convertRow(row);
  }, { ...CTX, method: 'ensureExists' });
}

/**
 * Delete a setting row. Rarely used (reset operations).
 */
export async function deleteByKey(settingKey) {
  return withDbErrors(async () => {
    return db('settings').where({ setting_key: settingKey }).delete();
  }, { ...CTX, method: 'deleteByKey' });
}
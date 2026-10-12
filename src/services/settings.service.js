import * as settingsRepo from '../db/repositories/settings.repository.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
} from '../utils/errors.js';
import { DEFAULT_SETTINGS } from '../constants/settings.js';
import logger from '../config/logger.js';

/**
 * Settings service.
 *
 * Storage changed from a single nested MongoDB document to key-value
 * rows in MySQL. Public API unchanged:
 *   - getSettings()  returns a nested object built from the rows
 *   - getSetting(path) returns one value
 *   - setSetting(actorId, path, value, { reason })
 *   - setSettings(actorId, patch, { reason })
 *   - resetSetting(actorId, path, { reason })
 *   - describeSettings() returns { doc, rows }
 *   - SETTINGS_PATHS is the whitelist
 */

// ============================================================
//  Whitelist — same as the MongoDB version
// ============================================================

function isStringIdOrNull(v) {
  if (v === null) return;
  if (typeof v !== 'string') {
    throw new ValidationError('Must be a Discord snowflake string or null.');
  }
  if (v.length < 10 || v.length > 30 || !/^\d+$/.test(v)) {
    throw new ValidationError('Must be a valid Discord ID (numeric, 10–30 digits).');
  }
}

function isBoolean(v) {
  if (typeof v !== 'boolean') throw new ValidationError('Must be true or false.');
}

function isPositiveInt(v) {
  if (!Number.isInteger(v) || v < 0) {
    throw new ValidationError('Must be a non-negative integer.');
  }
}

function isPositiveIntMinOne(v) {
  if (!Number.isInteger(v) || v < 1) {
    throw new ValidationError('Must be an integer ≥ 1.');
  }
}

function isTimezone(v) {
  if (typeof v !== 'string' || v.length < 3 || v.length > 64) {
    throw new ValidationError('Must be a valid IANA timezone string.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
  } catch {
    throw new ValidationError('Unknown timezone: ' + v);
  }
}

function isCronOrNull(v) {
  if (v === null) return;
  if (typeof v !== 'string') {
    throw new ValidationError('Must be a cron string or null.');
  }
  const parts = v.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    throw new ValidationError('Cron expression must have 5 or 6 fields.');
  }
}

export const SETTINGS_PATHS = Object.freeze({
  'channels.eventApprovalChannelId':   { description: 'Event approval channel',           validate: isStringIdOrNull },
  'channels.leaveApprovalChannelId':   { description: 'Leave approval channel',           validate: isStringIdOrNull },
  'channels.removalApprovalChannelId': { description: 'Removal approval channel',         validate: isStringIdOrNull },
  'channels.reportChannelId':          { description: 'Weekly report channel',            validate: isStringIdOrNull },
  'channels.auditChannelId':           { description: 'Audit log channel',                validate: isStringIdOrNull },
  'channels.syncLogChannelId':         { description: 'Roblox sync log channel',          validate: isStringIdOrNull },

  'roblox.groupId':                    { description: 'Roblox group ID',                  validate: isStringIdOrNull },
  'roblox.syncEnabled':                { description: 'Enable automatic Roblox sync',     validate: isBoolean },

  'events.approvalRequired':           { description: 'Require approval for events',      validate: isBoolean },
  'events.cooldownMinutes':            { description: 'Event log cooldown (minutes)',     validate: isPositiveInt },

  'quotas.weekStartsOn':               { description: 'Week starts on (0=Sun..6=Sat)',    validate: (v) => {
    if (!Number.isInteger(v) || v < 0 || v > 6) {
      throw new ValidationError('Must be an integer between 0 (Sun) and 6 (Sat).');
    }
  }},

  'strikes.removalThreshold':          { description: 'Strike threshold for removal',     validate: isPositiveIntMinOne },
  'strikes.autoIssueOnMissedQuota':    { description: 'Auto-issue strike on missed quota', validate: isBoolean },
  'strikes.autoRecoverOnDoubleQuota':  { description: 'Auto-recover on double quota',     validate: isBoolean },

  'reports.cronOverride':              { description: 'Report cron (overrides env)',      validate: isCronOrNull },
  'reports.displayTimezone':           { description: 'Report display timezone',          validate: isTimezone },

  'leaves.autoExemptOverlappingWeek':  { description: 'Leave exempts full week',          validate: isBoolean },

  'notices.autoExpire':                { description: 'Auto-expire notices',              validate: isBoolean },

  'notifications.dmAffectedUser':      { description: 'DM users on related actions',      validate: isBoolean },
  'notifications.pingChannel':         { description: 'Ping channel on related actions',  validate: isBoolean },

  'verification.codeTtlMinutes':       { description: 'Verification code TTL (minutes)',  validate: isPositiveIntMinOne },
  'verification.maxAttempts':          { description: 'Max verification attempts',        validate: isPositiveIntMinOne },
  'verification.relinkCooldownDays':   { description: 'Re-link cooldown (days)',          validate: isPositiveInt },
});

// ============================================================
//  Reads
// ============================================================

/**
 * Fetch the full settings document as a nested object.
 * If any setting is missing, it's filled from DEFAULT_SETTINGS.
 */
export async function getSettings() {
  const rows = await settingsRepo.listAll();
  const doc = { key: 'global' };

  // Build nested object from dotted paths.
  for (const row of rows) {
    const value = safeParse(row.value_json);
    writePath(doc, row.setting_key, value);
  }

  // Fill missing defaults.
  applyDefaults(doc, DEFAULT_SETTINGS);

  return doc;
}

export async function getSetting(path) {
  const row = await settingsRepo.findByKey(path);
  if (row) return safeParse(row.value_json);

  // Fall back to defaults
  return readPath(DEFAULT_SETTINGS, path);
}

function safeParse(json) {
  try {
    return typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
}

// ============================================================
//  Writes
// ============================================================

export async function setSetting(actorId, path, value, { reason = null } = {}) {
  const entry = assertWritablePath(path);
  entry.validate(value);

  const before = await getSetting(path);

  const group = path.split('.')[0];
  const valueType = inferType(value);

  await settingsRepo.upsert(path, group, value, valueType, {
    description: entry.description,
    updatedBy: actorId,
  });

  await audit({
    actorId,
    action: 'settings.changed',
    category: 'SETTINGS',
    targetType: 'Settings',
    targetId: path,
    before: { path, value: before },
    after: { path, value },
    reason,
  });

  logger.info({ actorId, path, value, reason }, 'Setting changed');
  return value;
}

export async function setSettings(actorId, patch, { reason = null } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError('patch must be an object keyed by dotted path.');
  }
  const entries = Object.entries(patch);
  if (entries.length === 0) {
    throw new ValidationError('patch must contain at least one setting.');
  }

  for (const [path, value] of entries) {
    const entry = assertWritablePath(path);
    entry.validate(value);
  }

  const beforeMap = {};
  for (const [path] of entries) beforeMap[path] = await getSetting(path);

  for (const [path, value] of entries) {
    const group = path.split('.')[0];
    const valueType = inferType(value);
    await settingsRepo.upsert(path, group, value, valueType, {
      description: SETTINGS_PATHS[path].description,
      updatedBy: actorId,
    });
  }

  const afterMap = {};
  for (const [path] of entries) afterMap[path] = await getSetting(path);

  await audit({
    actorId,
    action: 'settings.bulk_changed',
    category: 'SETTINGS',
    targetType: 'Settings',
    targetId: 'global',
    before: beforeMap,
    after: afterMap,
    reason,
  });

  logger.info({ actorId, count: entries.length, reason }, 'Settings bulk-updated');
  return afterMap;
}

export async function resetSetting(actorId, path, { reason = null } = {}) {
  assertWritablePath(path);
  const defaultValue = readPath(DEFAULT_SETTINGS, path);
  if (defaultValue === undefined) {
    throw new ValidationError('No seed default found for path: ' + path);
  }
  return setSetting(actorId, path, defaultValue, {
    reason: reason ? reason + ' (reset to default)' : 'reset to default',
  });
}

// ============================================================
//  Introspection
// ============================================================

export async function describeSettings() {
  const doc = await getSettings();
  const rows = Object.keys(SETTINGS_PATHS).map((path) => ({
    path,
    description: SETTINGS_PATHS[path].description,
    value: readPath(doc, path),
  }));
  return { doc, rows };
}

// ============================================================
//  Internals
// ============================================================

function assertWritablePath(path) {
  const entry = SETTINGS_PATHS[path];
  if (!entry) {
    throw new ValidationError('Setting "' + path + '" is not writable.');
  }
  return entry;
}

function readPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function writePath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function applyDefaults(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k]) target[k] = {};
      applyDefaults(target[k], v);
    } else if (target[k] === undefined) {
      target[k] = v;
    }
  }
}

function inferType(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'json';
}
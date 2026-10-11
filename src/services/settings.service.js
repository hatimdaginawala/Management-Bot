import { Settings } from '../models/index.js';
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
 * Settings is a single document (`key: 'global'`). All reads and writes
 * flow through this module. The shape is fixed by the schema; this
 * service only exposes a whitelist of writable paths.
 *
 * Why a whitelist:
 *   Discord commands accept user input. `setSetting(actorId, path, value)`
 *   would otherwise let a caller write to `_id` or `createdAt`. The
 *   whitelist plus a per-path validator makes this safe.
 */

// ============================================================
//  Writable path whitelist
// ============================================================
//
// Each entry:
//   path         the dotted path in the Settings document
//   description  shown in audit logs and /settings view
//   validate     (value) => true | throws ValidationError
//
// Add new entries here when a new setting becomes configurable.

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
    throw new ValidationError(`Unknown timezone: ${v}`);
  }
}

function isCronOrNull(v) {
  if (v === null) return;
  if (typeof v !== 'string') throw new ValidationError('Must be a cron string or null.');
  // Basic shape check; full validation happens when Phase 17 registers the job.
  const parts = v.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    throw new ValidationError('Cron expression must have 5 or 6 fields.');
  }
}

export const SETTINGS_PATHS = Object.freeze({
  // ----- channels -----
  'channels.eventApprovalChannelId':   { description: 'Event approval channel',         validate: isStringIdOrNull },
  'channels.leaveApprovalChannelId':   { description: 'Leave approval channel',         validate: isStringIdOrNull },
  'channels.removalApprovalChannelId': { description: 'Removal approval channel',       validate: isStringIdOrNull },
  'channels.reportChannelId':          { description: 'Weekly report channel',          validate: isStringIdOrNull },
  'channels.auditChannelId':           { description: 'Audit log channel',              validate: isStringIdOrNull },
  'channels.syncLogChannelId':         { description: 'Roblox sync log channel',        validate: isStringIdOrNull },

  // ----- roblox -----
  'roblox.groupId':                    { description: 'Roblox group ID',                validate: isStringIdOrNull },
  'roblox.syncEnabled':                { description: 'Enable automatic Roblox sync',   validate: isBoolean },

  // ----- events -----
  'events.approvalRequired':           { description: 'Require approval for events',    validate: isBoolean },
  'events.cooldownMinutes':            { description: 'Event log cooldown (minutes)',   validate: isPositiveInt },

  // ----- quotas -----
  'quotas.weekStartsOn':               { description: 'Week starts on (0=Sun..6=Sat)',  validate: isPositiveInt }, // tightened below

  // ----- strikes -----
  'strikes.removalThreshold':          { description: 'Strike threshold for removal',   validate: isPositiveIntMinOne },
  'strikes.autoIssueOnMissedQuota':    { description: 'Auto-issue strike on missed quota', validate: isBoolean },
  'strikes.autoRecoverOnDoubleQuota':  { description: 'Auto-recover on double quota',   validate: isBoolean },

  // ----- reports -----
  'reports.cronOverride':              { description: 'Report cron (overrides env)',    validate: isCronOrNull },
  'reports.displayTimezone':           { description: 'Report display timezone',        validate: isTimezone },

  // ----- leave -----
  'leaves.autoExemptOverlappingWeek':  { description: 'Leave exempts full week',        validate: isBoolean },

  // ----- notices -----
  'notices.autoExpire':                { description: 'Auto-expire notices',            validate: isBoolean },

  // ----- notifications -----
  'notifications.dmAffectedUser':      { description: 'DM users on related actions',    validate: isBoolean },
  'notifications.pingChannel':         { description: 'Ping channel on related actions', validate: isBoolean },

  // ----- verification -----
  'verification.codeTtlMinutes':       { description: 'Verification code TTL (minutes)', validate: isPositiveIntMinOne },
  'verification.maxAttempts':          { description: 'Max verification attempts',      validate: isPositiveIntMinOne },
  'verification.relinkCooldownDays':   { description: 'Re-link cooldown (days)',        validate: isPositiveInt },
});

// Tighten quotas.weekStartsOn to [0,6].
SETTINGS_PATHS['quotas.weekStartsOn'].validate = (v) => {
  if (!Number.isInteger(v) || v < 0 || v > 6) {
    throw new ValidationError('Must be an integer between 0 (Sun) and 6 (Sat).');
  }
};

// ============================================================
//  Reads
// ============================================================

/**
 * Fetch the full settings document. Creates the singleton on first
 * call if it doesn't exist yet (fresh install). Never returns null.
 */
export async function getSettings() {
  let doc = await Settings.findOne({ key: 'global' }).lean();
  if (!doc) {
    doc = (await Settings.create({ key: 'global' })).toObject();
  }
  return doc;
}

/**
 * Read one setting by dotted path.
 * Returns `undefined` for unknown paths and for missing values.
 */
export async function getSetting(path) {
  const doc = await getSettings();
  return readPath(doc, path);
}

// ============================================================
//  Writes
// ============================================================

/**
 * Set a single setting.
 * Throws ValidationError if the path is not whitelisted or the value
 * fails validation.
 *
 * Audit entry records before/after for the specific path.
 */
export async function setSetting(actorId, path, value, { reason = null } = {}) {
  const entry = assertWritablePath(path);
  entry.validate(value);

  const doc = await Settings.findOne({ key: 'global' });
  if (!doc) throw new NotFoundError('Settings', { key: 'global' });

  const before = readPath(doc.toObject(), path);
  writePath(doc, path, value);
  doc.lastUpdatedBy = actorId;
  await doc.save();

  await audit({
    actorId,
    action: 'settings.changed',
    category: 'SETTINGS',
    targetType: 'Settings',
    targetId: doc._id,
    before: { path, value: before },
    after: { path, value },
    reason,
  });

  logger.info({ actorId, path, value, reason }, 'Setting changed');
  return readPath(doc.toObject(), path);
}

/**
 * Set multiple settings in one write. All-or-nothing: if any path
 * fails validation, nothing is written.
 *
 * `patch` is a flat object keyed by dotted path:
 *   { 'events.approvalRequired': false, 'events.cooldownMinutes': 10 }
 *
 * Audit entry records the full before/after map for the touched paths.
 */
export async function setSettings(actorId, patch, { reason = null } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError('patch must be an object keyed by dotted path.');
  }
  const entries = Object.entries(patch);
  if (entries.length === 0) {
    throw new ValidationError('patch must contain at least one setting.');
  }

  // Validate everything up front.
  for (const [path, value] of entries) {
    const entry = assertWritablePath(path);
    entry.validate(value);
  }

  const doc = await Settings.findOne({ key: 'global' });
  if (!doc) throw new NotFoundError('Settings', { key: 'global' });

  const beforeMap = {};
  for (const [path] of entries) {
    beforeMap[path] = readPath(doc.toObject(), path);
  }

  for (const [path, value] of entries) {
    writePath(doc, path, value);
  }
  doc.lastUpdatedBy = actorId;
  await doc.save();

  const afterMap = {};
  for (const [path] of entries) {
    afterMap[path] = readPath(doc.toObject(), path);
  }

  await audit({
    actorId,
    action: 'settings.bulk_changed',
    category: 'SETTINGS',
    targetType: 'Settings',
    targetId: doc._id,
    before: beforeMap,
    after: afterMap,
    reason,
  });

  logger.info({ actorId, count: entries.length, reason }, 'Settings bulk-updated');
  return afterMap;
}

/**
 * Reset one path to its seed default (from DEFAULT_SETTINGS).
 */
export async function resetSetting(actorId, path, { reason = null } = {}) {
  assertWritablePath(path);

  const defaultValue = readPath(DEFAULT_SETTINGS, path);
  if (defaultValue === undefined) {
    throw new ValidationError(`No seed default found for path: ${path}`);
  }
  return setSetting(actorId, path, defaultValue, {
    reason: reason ? `${reason} (reset to default)` : 'reset to default',
  });
}

// ============================================================
//  Introspection (for /settings view)
// ============================================================

/**
 * Return the full settings snapshot plus a readable list of writable
 * paths with their current values. Used by /settings view.
 */
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
    throw new ValidationError(`Setting "${path}" is not writable.`);
  }
  return entry;
}

/**
 * Read a dotted path from a plain object.
 * `get(obj, 'a.b.c')` → obj.a.b.c
 * Returns undefined for missing intermediate fields.
 */
function readPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Write a dotted path into a Mongoose document, creating intermediate
 * plain objects if needed. We use `doc.set()` for the leaf so Mongoose
 * applies the schema.
 */
function writePath(doc, path, value) {
  const parts = path.split('.');
  const leaf = parts.pop();

  // Walk down. For existing Mongoose subpaths, `doc.get(prefix)` returns
  // a plain object; we rebuild the tree on the doc itself.
  if (parts.length === 0) {
    doc.set(leaf, value);
    return;
  }

  // Ensure every intermediate exists on the doc.
  let cur = doc;
  for (const p of parts) {
    if (cur[p] == null || typeof cur[p] !== 'object') {
      cur.set(p, {});
    }
    cur = cur[p];
  }
  doc.set(path, value);
}
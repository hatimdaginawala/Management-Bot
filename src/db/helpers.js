import { db } from './client.js';
import {
  ConflictError,
  ValidationError,
  DatabaseError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

/**
 * Columns that hold BIGINT UNSIGNED IDs and should be returned as
 * JavaScript numbers. Everything else (including discord_id and
 * roblox_id) stays as a string.
 *
 * Only add to this list if the column is defined as BIGINT UNSIGNED
 * in the migration.
 */
const NUMERIC_ID_COLUMNS = new Set([
  // Primary keys
  'id',

  // Foreign keys referencing primary keys
  'user_id',
  'role_id',
  'event_id',
  'period_id',
  'policy_id',
  'quota_period_id',
  'sync_log_id',
  'resolved_user_id',
  'host_user_id',
  'event_type_id',
]);

/**
 * Columns that are BOOLEAN (TINYINT(1)) but which repositories don't
 * always list explicitly. Repositories still pass booleanFields for
 * clarity; this is only a fallback.
 */
const AUTO_BOOLEAN_SUFFIXES = [];

export function convertRow(row, { booleanFields = [], jsonFields = [] } = {}) {
  if (!row) return null;
  const out = { ...row };

  // Numeric IDs → Number
  for (const key of Object.keys(out)) {
    if (NUMERIC_ID_COLUMNS.has(key) && out[key] !== null && out[key] !== undefined) {
      out[key] = Number(out[key]);
    }
  }

  // Boolean fields → real booleans
  for (const field of booleanFields) {
    if (out[field] !== undefined && out[field] !== null) {
      out[field] = Boolean(out[field]);
    }
  }

  // JSON fields → objects/arrays
  for (const field of jsonFields) {
    if (typeof out[field] === 'string') {
      try {
        out[field] = JSON.parse(out[field]);
      } catch {
        // leave as string if parsing fails
      }
    }
  }

  return out;
}



/**
 * Convert an array of rows.
 */
export function convertRows(rows, opts) {
  return rows.map((r) => convertRow(r, opts));
}

// ============================================================
//  Error translation
// ============================================================

/**
 * Wrap a repository operation so that MySQL errors become AppError
 * subclasses. Never lets a raw MySQL error escape to the service layer.
 */
export async function withDbErrors(fn, context = {}) {
  try {
    return await fn();
  } catch (err) {
    // Duplicate key → ConflictError
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      throw new ConflictError(
        'A record with that unique key already exists.',
        { ...context, sqlMessage: err.sqlMessage }
      );
    }

    // Foreign key violation (insert/update) → ValidationError
    if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
      throw new ValidationError(
        'Referenced record does not exist.',
        { ...context, sqlMessage: err.sqlMessage }
      );
    }

    // Foreign key violation (delete) → ConflictError
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
      throw new ConflictError(
        'Cannot delete: referenced by other records.',
        { ...context, sqlMessage: err.sqlMessage }
      );
    }

    // Data too long / out of range → ValidationError
    if (
      err.code === 'ER_DATA_TOO_LONG' ||
      err.code === 'ER_WARN_DATA_OUT_OF_RANGE'
    ) {
      throw new ValidationError('Value out of range or too long.', {
        ...context,
        sqlMessage: err.sqlMessage,
      });
    }

    // Any other MySQL error → DatabaseError
    logger.error(
      { err: err.message, code: err.code, ...context },
      'MySQL error in repository'
    );
    throw new DatabaseError('Database operation failed.', {
      ...context,
      code: err.code,
    });
  }
}

// ============================================================
//  Timestamp helpers
// ============================================================

/**
 * Return the current time as a MySQL-compatible Date.
 * The connection is set to UTC, so `new Date()` is safe.
 */
export function now() {
  return new Date();
}

// ============================================================
//  Re-export `db` for convenience
// ============================================================

export { db };
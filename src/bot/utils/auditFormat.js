/**
 * Presentation helpers for audit log entries.
 *
 * Audit rows contain raw IDs. This module decides how to render them:
 *   - Discord snowflakes → <@id>
 *   - "system"           → the literal text "system"
 *   - Small numbers (DB primary keys) → friendly references
 *   - Other strings      → as-is
 */

/**
 * A Discord snowflake is a 17–19 digit numeric string. More recent
 * snowflakes can be 19 digits; being generous with 15–25 keeps us safe
 * across Discord's evolving ID format.
 */
const DISCORD_ID_PATTERN = /^\d{15,25}$/;

/**
 * Render the actor of an audit entry.
 */
export function renderActor(actorId) {
  if (!actorId) return 'unknown';
  if (actorId === 'system') return 'system';
  if (DISCORD_ID_PATTERN.test(actorId)) return '<@' + actorId + '>';
  return '`' + actorId + '`';
}

/**
 * Render a target. Target types come from the schema:
 *   User, Role, Event, EventType, QuotaPolicy, QuotaPeriod, Strike,
 *   Leave, Notice, RemovalRequest, Settings, SyncLog, Report, ...
 *
 * For User, the target_id is the User's internal database id (a small
 * integer), NOT a Discord snowflake. We can't render a mention without
 * a lookup. Options:
 *   - Show a friendly label like "User #3"
 *   - Or leave as-is
 *
 * For Settings, target_id is often a settings path like
 * "events.cooldownMinutes" — show it in backticks.
 */
export function renderTarget(targetType, targetId) {
  if (!targetType) return 'unknown';
  if (!targetId) return targetType;

  // Settings paths
  if (targetType === 'Settings') {
    return '`' + targetId + '`';
  }

  // Internal DB IDs (small numbers) — show as "Type #id"
  if (/^\d{1,10}$/.test(String(targetId))) {
    return targetType + ' #' + targetId;
  }

  // Discord snowflake (some target types may reference Discord IDs)
  if (DISCORD_ID_PATTERN.test(String(targetId))) {
    return '<@' + targetId + '>';
  }

  // Fallback: short display
  return targetType + ' `' + String(targetId).slice(0, 24) + '`';
}

/**
 * Short, human-friendly timestamp from a Date or ISO string.
 * Used in the compact list view.
 */
export function compactTime(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return 'unknown time';
  return '<t:' + Math.floor(d.getTime() / 1000) + ':R>';
}

/**
 * Format a single audit entry as a one-line bullet for the list view.
 */
export function formatAuditLine(entry) {
  const ts = compactTime(entry.created_at);
  const actor = renderActor(entry.actor_id);
  const target = renderTarget(entry.target_type, entry.target_id);
  return '• ' + ts + ' `' + entry.category + '` **' + entry.action + '** by ' + actor + ' → ' + target;
}
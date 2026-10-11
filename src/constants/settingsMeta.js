/**
 * Presentation metadata for every writable setting path.
 *
 * Kept separate from `settings.service.js` because:
 *   - The service enforces behavior (validators, whitelist).
 *   - The command layer needs human labels, formatting hints, and grouping.
 *
 * If you add a new setting to `SETTINGS_PATHS`, add it here too. The
 * command layer reads from this map; missing entries fall back to the
 * raw path (with a warning logged).
 */

export const SETTINGS_META = Object.freeze({
  // ---------- channels ----------
  'channels.eventApprovalChannelId': {
    group: 'channels',
    label: 'Event approval channel',
    description: 'Where pending events are posted for review.',
    format: 'channel',
  },
  'channels.leaveApprovalChannelId': {
    group: 'channels',
    label: 'Leave approval channel',
    description: 'Where leave requests are posted for review.',
    format: 'channel',
  },
  'channels.removalApprovalChannelId': {
    group: 'channels',
    label: 'Removal approval channel',
    description: 'Where pending removals are posted for review.',
    format: 'channel',
  },
  'channels.reportChannelId': {
    group: 'channels',
    label: 'Report channel',
    description: 'Where the weekly report is posted.',
    format: 'channel',
  },
  'channels.auditChannelId': {
    group: 'channels',
    label: 'Audit channel',
    description: 'Where audit-worthy actions are announced.',
    format: 'channel',
  },
  'channels.syncLogChannelId': {
    group: 'channels',
    label: 'Sync log channel',
    description: 'Where Roblox sync results are announced.',
    format: 'channel',
  },

  // ---------- roblox ----------
  'roblox.groupId': {
    group: 'roblox',
    label: 'Roblox group ID',
    description: 'The Roblox group being managed.',
    format: 'string',
  },
  'roblox.syncEnabled': {
    group: 'roblox',
    label: 'Roblox sync enabled',
    description: 'Whether the scheduled Roblox sync job runs.',
    format: 'boolean',
  },

  // ---------- events ----------
  'events.approvalRequired': {
    group: 'events',
    label: 'Event approval required',
    description: 'If enabled, new events wait for High Command approval.',
    format: 'boolean',
  },
  'events.cooldownMinutes': {
    group: 'events',
    label: 'Event cooldown',
    description: 'Minimum minutes between events from the same host.',
    format: 'number:minutes',
  },

  // ---------- quotas ----------
  'quotas.weekStartsOn': {
    group: 'quotas',
    label: 'Week starts on',
    description: 'Weekday that starts a quota week.',
    format: 'weekday',
  },

  // ---------- strikes ----------
  'strikes.removalThreshold': {
    group: 'strikes',
    label: 'Removal strike threshold',
    description: 'Number of active strikes that triggers a pending removal.',
    format: 'number:count',
  },
  'strikes.autoIssueOnMissedQuota': {
    group: 'strikes',
    label: 'Auto-issue strikes on missed quota',
    description: 'If enabled, missing weekly quota automatically adds a strike.',
    format: 'boolean',
  },
  'strikes.autoRecoverOnDoubleQuota': {
    group: 'strikes',
    label: 'Auto-recover on double quota',
    description: 'If enabled, hosting/attending double quota removes one strike.',
    format: 'boolean',
  },

  // ---------- reports ----------
  'reports.cronOverride': {
    group: 'reports',
    label: 'Report cron override',
    description: 'Overrides the weekly report cron (leave unset to use env config).',
    format: 'cron',
  },
  'reports.displayTimezone': {
    group: 'reports',
    label: 'Report display timezone',
    description: 'Timezone used to render report timestamps.',
    format: 'timezone',
  },

  // ---------- leaves ----------
  'leaves.autoExemptOverlappingWeek': {
    group: 'leaves',
    label: 'Leave exempts overlapping week',
    description: 'If enabled, an approved leave exempts the whole overlapping week.',
    format: 'boolean',
  },

  // ---------- notices ----------
  'notices.autoExpire': {
    group: 'notices',
    label: 'Auto-expire notices',
    description: 'If enabled, notices expire automatically when their end date passes.',
    format: 'boolean',
  },

  // ---------- notifications ----------
  'notifications.dmAffectedUser': {
    group: 'notifications',
    label: 'DM affected users',
    description: 'If enabled, users receive a DM when they are affected by an action.',
    format: 'boolean',
  },
  'notifications.pingChannel': {
    group: 'notifications',
    label: 'Ping channel on action',
    description: 'If enabled, the bot pings a channel when an action is performed.',
    format: 'boolean',
  },

  // ---------- verification ----------
  'verification.codeTtlMinutes': {
    group: 'verification',
    label: 'Verification code TTL',
    description: 'How long a verification code stays valid.',
    format: 'number:minutes',
  },
  'verification.maxAttempts': {
    group: 'verification',
    label: 'Verification max attempts',
    description: 'How many failed checks before a code is invalidated.',
    format: 'number:count',
  },
  'verification.relinkCooldownDays': {
    group: 'verification',
    label: 'Re-link cooldown',
    description: 'How long a user must wait after unlinking before re-linking.',
    format: 'number:days',
  },
});

/** Group display order and human labels. */
export const SETTINGS_GROUPS = Object.freeze([
  { key: 'channels',      label: 'Channels',       emoji: '📢' },
  { key: 'roblox',        label: 'Roblox',         emoji: '🎮' },
  { key: 'events',        label: 'Events',         emoji: '📅' },
  { key: 'quotas',        label: 'Quotas',         emoji: '📊' },
  { key: 'strikes',       label: 'Strikes',        emoji: '⚠️' },
  { key: 'reports',       label: 'Reports',        emoji: '📄' },
  { key: 'leaves',        label: 'Leaves',         emoji: '🌴' },
  { key: 'notices',       label: 'Notices',        emoji: '📌' },
  { key: 'notifications', label: 'Notifications',  emoji: '🔔' },
  { key: 'verification',  label: 'Verification',   emoji: '🔗' },
]);

/**
 * Format a value for display given the meta's format hint.
 */
export function formatSettingValue(value, format) {
  if (value === null || value === undefined) return '*not set*';

  switch (format) {
    case 'boolean':
      return value ? '✅ Enabled' : '❌ Disabled';
    case 'channel':
      // Value is a snowflake; if it looks like one, render as a mention.
      return /^\d{15,25}$/.test(String(value)) ? '<#' + value + '>' : '`' + value + '`';
    case 'number:minutes':
      return '**' + value + '** minute(s)';
    case 'number:days':
      return '**' + value + '** day(s)';
    case 'number:count':
      return '**' + value + '**';
    case 'weekday': {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return days[value] || ('`' + value + '`');
    }
    case 'timezone':
      return '`' + value + '`';
    case 'cron':
      return '`' + value + '`';
    case 'string':
    default:
      return '`' + String(value) + '`';
  }
}
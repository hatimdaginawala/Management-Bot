/**
 * Default settings for the singleton Settings document.
 * Uses $setOnInsert so re-running the seed NEVER overwrites
 * live settings — it only fills in fields that are missing.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  key: 'global',

  channels: {
    eventApprovalChannelId: null,
    leaveApprovalChannelId: null,
    removalApprovalChannelId: null,
    reportChannelId: null,
    auditChannelId: null,
    syncLogChannelId: null,
  },

  roblox: {
    groupId: null,        // populated from env at first boot (see seedSettings)
    syncEnabled: true,
  },

  events: {
    approvalRequired: true,       // §15: configurable
    cooldownMinutes: 5,           // A3 / §14: 5-min cooldown
    allowedTypeKeys: [],          // empty = allow all active types
  },

  quotas: {
    currentPeriodKey: null,       // maintained by weekly job
    weekStartsOn: 1,              // Monday-start ISO weeks
  },

  strikes: {
    removalThreshold: 3,          // §25: configurable, default 3
    autoIssueOnMissedQuota: true,
    autoRecoverOnDoubleQuota: true,
  },

  reports: {
    cronOverride: null,           // use config.cron.weeklyReport
    displayTimezone: 'Asia/Kolkata',
  },

  leaves: {
    autoExemptOverlappingWeek: true, // D4: full-week exempt
  },

  notices: {
    autoExpire: true,
  },

  notifications: {
    dmAffectedUser: true,         // B9: both
    pingChannel: true,
  },

  verification: {
    codeTtlMinutes: 30,
    maxAttempts: 5,
    relinkCooldownDays: 7,        // D12
  },
});
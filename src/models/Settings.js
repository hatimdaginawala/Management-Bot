import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Settings is stored as a single document with a stable key.
 * Reading is cheap; writes are rare and audited.
 *
 * Fields are grouped by domain and defaulted from seed data.
 * Changing the schema shape requires a migration — which is why
 * everything is nested rather than top-level.
 */
const SettingsSchema = new Schema(
  {
    // Fixed key for the singleton document.
    key: { type: String, required: true, unique: true, default: 'global' },

    // ----- Discord channels -----
    channels: {
      // Where new PENDING events are posted for review.
      eventApprovalChannelId: { type: String, default: null, trim: true },
      // Where leave requests are posted for review.
      leaveApprovalChannelId: { type: String, default: null, trim: true },
      // Where pending removals are posted for review.
      removalApprovalChannelId: { type: String, default: null, trim: true },
      // Where the weekly report is posted.
      reportChannelId: { type: String, default: null, trim: true },
      // Where audit-worthy actions are announced.
      auditChannelId: { type: String, default: null, trim: true },
      // Where Roblox sync results are announced.
      syncLogChannelId: { type: String, default: null, trim: true },
    },

    // ----- Roblox -----
    roblox: {
      groupId: { type: String, default: null, trim: true },
      syncEnabled: { type: Boolean, default: true },
    },

    // ----- Events -----
    events: {
      approvalRequired: { type: Boolean, default: true },
      cooldownMinutes: { type: Number, default: 5, min: 0 },
      // Event types allowed for /event create.
      // Empty array = all active EventType rows allowed.
      allowedTypeKeys: { type: [String], default: [] },
    },

    // ----- Quotas -----
    quotas: {
      // The period key of the currently OPEN period.
      // Maintained by the weekly job.
      currentPeriodKey: { type: String, default: null, trim: true },
      // Which weekday ends the week (0=Sun..6=Sat). Default Monday-start.
      weekStartsOn: { type: Number, default: 1, min: 0, max: 6 },
    },

    // ----- Strikes -----
    strikes: {
      // Strike count that triggers a pending removal.
      removalThreshold: { type: Number, default: 3, min: 1 },
      // Auto-issue strikes on missed quota?
      autoIssueOnMissedQuota: { type: Boolean, default: true },
      // Auto-apply recovery when double-quota achieved?
      autoRecoverOnDoubleQuota: { type: Boolean, default: true },
    },

    // ----- Reports -----
    reports: {
      // Cron override; if null, use config.cron.weeklyReport.
      cronOverride: { type: String, default: null, trim: true },
      // Display timezone in reports.
      displayTimezone: { type: String, default: 'Asia/Kolkata', trim: true },
    },

    // ----- Leave / Notices -----
    leaves: {
      // Automatically exempt quota for the week when an approved leave
      // overlaps any part of it (D4).
      autoExemptOverlappingWeek: { type: Boolean, default: true },
    },

    notices: {
      // Automatically expire notices with endAt in the past.
      autoExpire: { type: Boolean, default: true },
    },

    // ----- Notifications (B9: configurable, both) -----
    notifications: {
      dmAffectedUser: { type: Boolean, default: true },
      pingChannel: { type: Boolean, default: true },
    },

    // ----- Verification -----
    verification: {
      // Code lifetime in minutes.
      codeTtlMinutes: { type: Number, default: 30, min: 1 },
      // Attempts allowed before the code is invalidated.
      maxAttempts: { type: Number, default: 5, min: 1 },
      // Cooldown after unlink before re-verification is allowed (D12).
      relinkCooldownDays: { type: Number, default: 7, min: 0 },
    },

    // ----- Audit / metadata -----
    lastUpdatedBy: { type: String, default: 'system', trim: true },
  },
  {
    timestamps: true,
    collection: 'settings',
  }
);

export const Settings = mongoose.model('Settings', SettingsSchema);
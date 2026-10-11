import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Snapshot of the top-N lists embedded in the report so the
 * report is self-contained and reproducible even after source data changes.
 */
const TopEntrySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    discordId: { type: String, default: null, trim: true },
    displayName: { type: String, default: null, trim: true },
    count: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const ReportSchema = new Schema(
  {
    // WEEKLY / MONTHLY / MANUAL.
    kind: {
      type: String,
      enum: ['WEEKLY', 'MONTHLY', 'MANUAL'],
      required: true,
      index: true,
    },

    // Deterministic key for scheduled reports.
    // e.g. "WEEKLY:2026-W41", "MONTHLY:2026-10". Null for MANUAL.
    reportKey: { type: String, default: null, index: true, trim: true },

    // Coverage window.
    periodStart: { type: Date, required: true, index: true },
    periodEnd: { type: Date, required: true, index: true },

    generatedAt: { type: Date, default: Date.now, index: true },
    generatedBy: { type: String, required: true, default: 'system', trim: true },

    // Where the report was posted.
    channelId: { type: String, default: null, trim: true },
    messageId: { type: String, default: null, trim: true },

    // -------- Report content (structured) --------

    // Summary counts.
    summary: {
      activeMembers: { type: Number, default: 0, min: 0 },
      totalEvents: { type: Number, default: 0, min: 0 },
      totalAttendance: { type: Number, default: 0, min: 0 },
      newStrikes: { type: Number, default: 0, min: 0 },
      recoveredStrikes: { type: Number, default: 0, min: 0 },
      pendingRemovals: { type: Number, default: 0, min: 0 },
      activeLeaves: { type: Number, default: 0, min: 0 },
      activeNotices: { type: Number, default: 0, min: 0 },
    },

    // Events by type.
    eventsByType: {
      type: [
        new Schema(
          { typeKey: { type: String, required: true }, count: { type: Number, default: 0 } },
          { _id: false }
        ),
      ],
      default: [],
    },

    // Top hosts and attendees.
    topHosts: { type: [TopEntrySchema], default: [] },
    topAttendees: { type: [TopEntrySchema], default: [] },

    // Quota performance.
    quota: {
      staffCompleted: { type: Number, default: 0, min: 0 },
      staffMissed: { type: Number, default: 0, min: 0 },
      lowRankCompleted: { type: Number, default: 0, min: 0 },
      lowRankMissed: { type: Number, default: 0, min: 0 },
    },

    // Roblox sync summary (from the most recent sync in-window).
    syncSummary: {
      membersFetched: { type: Number, default: 0, min: 0 },
      membersCreated: { type: Number, default: 0, min: 0 },
      membersUpdated: { type: Number, default: 0, min: 0 },
      rankChanges: { type: Number, default: 0, min: 0 },
      membersRemoved: { type: Number, default: 0, min: 0 },
      syncCount: { type: Number, default: 0, min: 0 },
    },

    // Raw rendered Discord embed JSON (for reposting/exporting).
    renderedPayload: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    collection: 'reports',
  }
);

/**
 * Scheduled reports (WEEKLY/MONTHLY) have a deterministic key.
 * Manual reports have reportKey = null and are allowed to duplicate.
 */
ReportSchema.index(
  { kind: 1, reportKey: 1 },
  {
    unique: true,
    partialFilterExpression: { reportKey: { $type: 'string' } },
    name: 'uniq_scheduled_report',
  }
);

// Fast: recent reports for /report history.
ReportSchema.index(
  { kind: 1, generatedAt: -1 },
  { name: 'kind_generated_desc' }
);

export const Report = mongoose.model('Report', ReportSchema);
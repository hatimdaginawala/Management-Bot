import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Individual error captured during a sync.
 * Kept small and bounded so a single bad run cannot bloat the document.
 */
const SyncErrorSchema = new Schema(
  {
    stage: { type: String, trim: true, default: null },     // e.g. "fetch-members"
    robloxId: { type: String, trim: true, default: null },
    discordId: { type: String, trim: true, default: null },
    message: { type: String, required: true, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SyncLogSchema = new Schema(
  {
    // Only one sync type today; reserved for future syncs
    // (e.g. DISCORD_ROLE_SYNC if we ever add it).
    type: {
      type: String,
      enum: ['ROBLOX_GROUP_SYNC'],
      required: true,
      default: 'ROBLOX_GROUP_SYNC',
      index: true,
    },

    // Who triggered the sync: "system" for cron, discordId for manual.
    triggeredBy: { type: String, required: true, default: 'system', trim: true },

    startedAt: { type: Date, required: true, default: Date.now, index: true },
    completedAt: { type: Date, default: null, index: true },

    // Lifecycle. RUNNING is set at creation; the service atomically
    // transitions to a terminal state on completion.
    status: {
      type: String,
      enum: ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'],
      default: 'RUNNING',
      index: true,
    },

    // Aggregated counters.
    membersFetched: { type: Number, default: 0, min: 0 },
    membersCreated: { type: Number, default: 0, min: 0 },
    membersUpdated: { type: Number, default: 0, min: 0 },
    rankChanges: { type: Number, default: 0, min: 0 },
    membersRemoved: { type: Number, default: 0, min: 0 },

    // Bounded list of errors. Cap enforced by the service (see notes).
capturedErrors: { type: [SyncErrorSchema], default: [] },

    // Optional free-form summary the service may attach.
    summary: { type: String, trim: true, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'sync_logs',
  }
);

/**
 * Fast: "is a sync currently running?" — used to prevent overlap.
 * Partial unique index: at most one RUNNING sync of each type.
 */
SyncLogSchema.index(
  { type: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'RUNNING' },
    name: 'uniq_running_per_type',
  }
);

// Fast: recent sync history for the /sync status command.
SyncLogSchema.index(
  { type: 1, startedAt: -1 },
  { name: 'type_started_desc' }
);

export const SyncLog = mongoose.model('SyncLog', SyncLogSchema);
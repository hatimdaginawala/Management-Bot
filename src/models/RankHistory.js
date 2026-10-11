import mongoose from 'mongoose';

const { Schema } = mongoose;

const RankSnapshotSchema = new Schema(
  {
    rankId: { type: Number, default: null },
    rankName: { type: String, default: null, trim: true },
    rankValue: { type: Number, default: null },
  },
  { _id: false }
);

const RankHistorySchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    discordId: { type: String, required: true, index: true, trim: true },
    robloxId: { type: String, required: true, index: true, trim: true },

    // Before and after snapshots. Either may have nulls if we're
    // capturing a transition from/to "not in group".
    oldRank: { type: RankSnapshotSchema, required: true },
    newRank: { type: RankSnapshotSchema, required: true },

    changedAt: { type: Date, required: true, default: Date.now, index: true },

    // How we learned about the change.
    // SYNC   = Roblox group sync detected a difference
    // MANUAL = An authorized user recorded it manually (future)
    // IMPORT = Backfill from an external source
    source: {
      type: String,
      enum: ['SYNC', 'MANUAL', 'IMPORT'],
      default: 'SYNC',
      index: true,
    },

    // Reference to the SyncLog that observed this change, when applicable.
    syncLog: {
      type: Schema.Types.ObjectId,
      ref: 'SyncLog',
      default: null,
      index: true,
    },

    // Human-readable note (e.g. "promoted in ceremony").
    note: { type: String, trim: true, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'rank_history',
  }
);

/**
 * Fast: /rank history @user — chronological rank changes for a user.
 */
RankHistorySchema.index(
  { user: 1, changedAt: -1 },
  { name: 'user_changedAt_desc' }
);

/**
 * Fast: "all rank changes during this sync" for reports.
 */
RankHistorySchema.index(
  { syncLog: 1 },
  { name: 'syncLog' }
);

export const RankHistory = mongoose.model('RankHistory', RankHistorySchema);
import mongoose from 'mongoose';

const { Schema } = mongoose;

const QuotaResultSchema = new Schema(
  {
    period: {
      type: Schema.Types.ObjectId,
      ref: 'QuotaPeriod',
      required: true,
      index: true,
    },
    // Snapshot for query convenience.
    periodKey: { type: String, required: true, index: true, trim: true },

    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    discordId: { type: String, required: true, index: true, trim: true },

    // Which category was evaluated. One row per (user, period, category).
    category: {
      type: String,
      enum: ['STAFF', 'LOW_RANK'],
      required: true,
      index: true,
    },

    metric: { type: String, required: true },
    required: { type: Number, required: true, min: 0 },
    actual: { type: Number, required: true, min: 0 },

    // Completion state.
    // MET = actual >= required
    // MISSED = actual < required
    // EXEMPT = user was on leave / individually exempt
    // SKIPPED = user was not eligible (no category role at close time)
    status: {
      type: String,
      enum: ['MET', 'MISSED', 'EXEMPT', 'SKIPPED'],
      required: true,
      index: true,
    },

    // Reason for EXEMPT: 'LEAVE' | 'MANUAL' | null.
    exemptReason: { type: String, default: null, trim: true },

    // Was a strike issued as a result of this result?
    strikeIssued: { type: Boolean, default: false },

    // Was a strike recovered as a result of this result?
    // (double-quota recovery per D7)
    recoveryApplied: { type: Boolean, default: false },
    recoveriesCount: { type: Number, default: 0, min: 0 },

    // When the row was computed.
    evaluatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'quota_results',
  }
);

/**
 * Idempotency anchor: exactly one row per (user, period, category).
 * Re-running the weekly job upserts rather than duplicating.
 */
QuotaResultSchema.index(
  { user: 1, period: 1, category: 1 },
  { unique: true, name: 'uniq_user_period_category' }
);

// Fast: fetch all results for a period.
QuotaResultSchema.index(
  { period: 1, status: 1 },
  { name: 'period_status' }
);

export const QuotaResult = mongoose.model('QuotaResult', QuotaResultSchema);
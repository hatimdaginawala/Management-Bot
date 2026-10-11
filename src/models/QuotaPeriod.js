import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Immutable snapshot of the policy that was in force when the period closed.
 * Stored as a sub-document so historical periods do not drift when
 * policies change later.
 */
const PolicySnapshotSchema = new Schema(
  {
    policyId: { type: Schema.Types.ObjectId, ref: 'QuotaPolicy', required: true },
    category: { type: String, required: true },
    metric: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    recoveryMultiplier: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const QuotaPeriodSchema = new Schema(
  {
    // Deterministic ISO-week key, e.g. "2026-W41".
    // This is the idempotency anchor: running the job twice
    // upserts the same document instead of creating a new one.
    periodKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    // Inclusive start (Monday 00:00 UTC of the ISO week).
    startAt: { type: Date, required: true, index: true },
    // Exclusive end (Monday 00:00 UTC of the following week).
    endAt: { type: Date, required: true, index: true },

    // Snapshot of the policies in force for this period.
    // STAFF and LOW_RANK entries only.
    policies: { type: [PolicySnapshotSchema], default: [] },

    // Lifecycle. OPEN -> CLOSING -> CLOSED.
    // OPEN: current period, attendance/hosting still accrue.
    // CLOSING: evaluation in progress (guard against double-run).
    // CLOSED: evaluation complete, results written.
    status: {
      type: String,
      enum: ['OPEN', 'CLOSING', 'CLOSED'],
      default: 'OPEN',
      index: true,
    },

    // When the evaluation job completed. Null while OPEN/CLOSING.
    closedAt: { type: Date, default: null },

    // Optional metadata from the closing run.
    evaluatedCount: { type: Number, default: 0 },
    strikesIssuedCount: { type: Number, default: 0 },
    recoveriesAppliedCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'quota_periods',
  }
);

// Fast: get the currently OPEN period.
QuotaPeriodSchema.index(
  { status: 1, startAt: -1 },
  { name: 'status_start_desc' }
);

export const QuotaPeriod = mongoose.model('QuotaPeriod', QuotaPeriodSchema);
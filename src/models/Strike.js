import mongoose from 'mongoose';

const { Schema } = mongoose;

const StrikeSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    discordId: { type: String, required: true, index: true, trim: true },

    // What caused the strike.
    // QUOTA_MISSED = weekly evaluation
    // MANUAL       = issued by staff via /strike issue
    type: {
      type: String,
      enum: ['QUOTA_MISSED', 'MANUAL'],
      required: true,
      index: true,
    },

    // For QUOTA_MISSED, always set. For MANUAL, optional.
    quotaPeriodKey: { type: String, default: null, index: true, trim: true },

    // For MANUAL, the reason text. For QUOTA_MISSED, a template string.
    reason: { type: String, required: true, trim: true },

    issuedBy: { type: String, required: true, trim: true }, // "system" or discordId
    issuedAt: { type: Date, default: Date.now, index: true },

    // Lifecycle:
    // ACTIVE    -> counts toward threshold
    // RECOVERED -> removed via double-quota recovery (D7)
    // CANCELLED -> removed manually or by rejoin reset (D10)
    // EXPIRED   -> reserved for future time-based expiry
    status: {
      type: String,
      enum: ['ACTIVE', 'RECOVERED', 'CANCELLED', 'EXPIRED'],
      default: 'ACTIVE',
      index: true,
    },

    // When recovery/removal happened.
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: null, trim: true },
    resolutionReason: { type: String, default: null, trim: true },

    // Which quota period was the recovery earned in? (D7)
    // Null until recovered.
    recoveredInPeriodKey: { type: String, default: null, trim: true },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'strikes',
  }
);

/**
 * Idempotency: for QUOTA_MISSED, only ONE active strike
 * per (user, periodKey) may exist. Duplicate weekly runs cannot
 * create a second strike for the same miss.
 */
StrikeSchema.index(
  { user: 1, quotaPeriodKey: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: 'QUOTA_MISSED' },
    name: 'uniq_quota_strike_per_user_period',
  }
);

// Fast: count of active strikes per user (threshold check).
StrikeSchema.index(
  { user: 1, status: 1 },
  { name: 'user_status' }
);

export const Strike = mongoose.model('Strike', StrikeSchema);
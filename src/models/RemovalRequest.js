import mongoose from 'mongoose';
import { REMOVAL_MIN_ADVANCE_DAYS } from '../config/constants.js';

const { Schema } = mongoose;

const RemovalRequestSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    discordId: { type: String, required: true, index: true, trim: true },

    // Why the removal was requested.
    // THRESHOLD = automatic (strike threshold reached)
    // MANUAL    = issued by staff directly
    reason: {
      type: String,
      enum: ['THRESHOLD', 'MANUAL'],
      required: true,
      index: true,
    },

    // Snapshot of the strike count at time of creation.
    strikeCount: { type: Number, required: true, min: 0 },
    strikeThreshold: { type: Number, required: true, min: 1 },

    // Free-text reason shown in the approval UI.
    description: { type: String, trim: true, default: '' },

    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'DISMISSED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },

    // Review metadata.
    reviewedBy: { type: String, default: null, trim: true },
    reviewedAt: { type: Date, default: null },
    reviewReason: { type: String, default: null, trim: true },

    // D8: when approved, we set a date at least 3 days in the future.
    // A scheduled job flips the user to LEFT_ROBLOX_GROUP at this date.
    removalEffectiveAt: { type: Date, default: null, index: true },

    // Set when the removal job actually applies the transition.
    appliedAt: { type: Date, default: null },

    // Prevent duplicate pending requests for the same user
    // (see partial unique index below).
  },
  {
    timestamps: true,
    collection: 'removal_requests',
  }
);

/**
 * A user may only have one PENDING removal request at a time.
 * Prevents a user with 5 strikes from generating 5 requests.
 */
RemovalRequestSchema.index(
  { user: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'PENDING' },
    name: 'uniq_pending_per_user',
  }
);

// Fast: the Phase 17 job finds APPROVED requests whose removalEffectiveAt has passed.
RemovalRequestSchema.index(
  { status: 1, removalEffectiveAt: 1 },
  { name: 'status_effectiveAt' }
);

export const RemovalRequest = mongoose.model(
  'RemovalRequest',
  RemovalRequestSchema
);
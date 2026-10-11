import mongoose from 'mongoose';

const { Schema } = mongoose;

const LeaveSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    discordId: { type: String, required: true, index: true, trim: true },

    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true, index: true },

    reason: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },

    // Review metadata.
    reviewedBy: { type: String, default: null, trim: true },
    reviewedAt: { type: Date, default: null },
    reviewReason: { type: String, default: null, trim: true },

    // Set automatically by the expiration job when endAt passes.
    expiredAt: { type: Date, default: null },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'leaves',
  }
);

/**
 * A user may only have one PENDING or APPROVED leave at a time.
 * Prevents accidental overlapping leaves during normal use.
 */
LeaveSchema.index(
  { user: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED'] } },
    name: 'uniq_open_leave_per_user',
  }
);

// Fast: find leaves that overlap a given period (for quota evaluation).
LeaveSchema.index(
  { status: 1, startAt: 1, endAt: 1 },
  { name: 'status_range' }
);

// Fast: expiration sweep (APPROVED leaves past endAt).
LeaveSchema.index(
  { status: 1, endAt: 1 },
  { name: 'status_endAt' }
);

export const Leave = mongoose.model('Leave', LeaveSchema);
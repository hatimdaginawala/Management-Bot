import mongoose from 'mongoose';

const { Schema } = mongoose;

const NoticeSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    discordId: { type: String, required: true, index: true, trim: true },

    // Type of notice.
    type: {
      type: String,
      enum: ['INACTIVITY', 'WARNING', 'ADMINISTRATIVE', 'OTHER'],
      required: true,
      index: true,
    },

    reason: { type: String, required: true, trim: true },

    startAt: { type: Date, required: true, default: Date.now, index: true },
    // Optional — some notices are open-ended.
    endAt: { type: Date, default: null, index: true },

    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
      default: 'ACTIVE',
      index: true,
    },

    // Whether the notice grants quota exemption (typically INACTIVITY = true).
    grantsQuotaExemption: { type: Boolean, default: false },

    createdBy: { type: String, required: true, trim: true },
    expiredAt: { type: Date, default: null },
    cancelledBy: { type: String, default: null, trim: true },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null, trim: true },

    notes: { type: String, trim: true, default: '' },
     pendingExtension: {
      requestedBy: { type: String, default: null, trim: true },
      requestedAt: { type: Date, default: null },
      newEndAt: { type: Date, default: null },
      reason: { type: String, default: null, trim: true },
      status: {
        type: String,
        enum: ['NONE', 'PENDING', 'APPROVED', 'REJECTED'],
        default: 'NONE',
      },
      reviewedBy: { type: String, default: null, trim: true },
      reviewedAt: { type: Date, default: null },
      reviewReason: { type: String, default: null, trim: true },}
  },
  
  {
    timestamps: true,
    collection: 'notices',
  }
);

// Fast: active notices for a user.
NoticeSchema.index(
  { user: 1, status: 1 },
  { name: 'user_status' }
);

// Fast: expiration sweep.
NoticeSchema.index(
  { status: 1, endAt: 1 },
  { name: 'status_endAt' }
);

export const Notice = mongoose.model('Notice', NoticeSchema);
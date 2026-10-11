import mongoose from 'mongoose';
import { EVENT_STATUS } from './enums.js';

const { Schema } = mongoose;

/**
 * Host identity is denormalized onto the event so historical
 * reports remain stable even if the user later changes name/rank.
 */
const HostSnapshotSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    discordId: { type: String, required: true, trim: true },
    discordUsername: { type: String, trim: true, default: null },
    robloxId: { type: String, trim: true, default: null },
    robloxUsername: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const EventSchema = new Schema(
  {
    // Host snapshot (immutable identity at time of creation).
    host: { type: HostSnapshotSchema, required: true },

    // Reference to the EventType catalog for filtering/aggregation.
    eventType: {
      type: Schema.Types.ObjectId,
      ref: 'EventType',
      required: true,
      index: true,
    },
    // Snapshot the key for aggregation without a populate.
    eventTypeKey: { type: String, required: true, index: true, trim: true },

    // ----- Attendees: raw input, immutable -----
    // Stored as array of attendee entries captured at creation time.
    // The Attendance collection is the derived, canonical source for quota.
    attendeeEntries: {
      type: [
        {
          _id: false,
          discordId: { type: String, trim: true },
          robloxUsername: { type: String, trim: true },
          resolvedUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
          },
          isVerified: { type: Boolean, default: false },
        },
      ],
      default: [],
    },

    // ----- Proof & metadata -----
    proofUrl: { type: String, required: true, trim: true },
    notes: { type: String, trim: true, default: '' },

    // ----- Approval lifecycle -----
    status: {
      type: String,
      enum: Object.values(EVENT_STATUS),
      default: EVENT_STATUS.PENDING,
      index: true,
    },

    createdBy: { type: String, required: true, trim: true }, // discordId of logger
    approvedBy: { type: String, default: null, trim: true },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: null, trim: true },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null },

    // Cancel metadata (only for approved events that are cancelled later).
    cancelledBy: { type: String, default: null, trim: true },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, default: null },

    // Used by the 5-minute cooldown enforcement.
    // Indexed so the service can quickly find the host's most recent event.
    cooldownAnchor: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
    collection: 'events',
  }
);

/**
 * Fast: recent events by host (cooldown check + hosting stats).
 */
EventSchema.index(
  { 'host.discordId': 1, createdAt: -1 },
  { name: 'host_created_desc' }
);

/**
 * Fast: recent approved events by type for statistics.
 */
EventSchema.index(
  { status: 1, eventTypeKey: 1, createdAt: -1 },
  { name: 'status_type_created_desc' }
);

export const Event = mongoose.model('Event', EventSchema);
import mongoose from 'mongoose';
import { ATTENDANCE_STATUS } from './enums.js';

const { Schema } = mongoose;

const AttendanceSchema = new Schema(
  {
    event: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },
    eventTypeKey: { type: String, required: true, index: true, trim: true },

    // The attendee.
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    discordId: { type: String, required: true, index: true, trim: true },
    robloxId: { type: String, default: null, trim: true },

    // Snapshot of when the event occurred (used for weekly attribution).
    eventAt: { type: Date, required: true, index: true },

    // Present by default; manual edits change this.
    status: {
      type: String,
      enum: Object.values(ATTENDANCE_STATUS),
      default: ATTENDANCE_STATUS.PRESENT,
      index: true,
    },

    // Manual-edit metadata.
    addedBy: { type: String, default: null, trim: true },
    removedBy: { type: String, default: null, trim: true },
    reason: { type: String, trim: true, default: null },

    // Effective record: false when status is MANUAL_REMOVED.
    // Kept so quota queries can filter with a single equality.
    active: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    collection: 'attendance',
  }
);

/**
 * CRITICAL idempotency constraint:
 * one attendance row per (event, user).
 * Duplicate inserts during event approval are silently rejected.
 */
AttendanceSchema.index(
  { event: 1, user: 1 },
  { unique: true, name: 'uniq_event_user' }
);

/**
 * Fast: "how many events did this user attend in [range]".
 */
AttendanceSchema.index(
  { user: 1, active: 1, eventAt: -1 },
  { name: 'user_active_eventAt_desc' }
);

/**
 * Fast: "how many people attended event X".
 */
AttendanceSchema.index(
  { event: 1, active: 1 },
  { name: 'event_active' }
);

export const Attendance = mongoose.model('Attendance', AttendanceSchema);
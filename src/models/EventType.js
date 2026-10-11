import mongoose from 'mongoose';

const { Schema } = mongoose;

const EventTypeSchema = new Schema(
  {
    // Machine key, e.g. "patrol".
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },

    // Display label, e.g. "Patrol".
    name: { type: String, required: true, trim: true },

    description: { type: String, trim: true, default: '' },

    // Whether this type counts toward quota metrics.
    // All seeded types count; this allows future "training only" types.
    countsForQuota: { type: Boolean, default: true },

    // Whether this type may be selected in /event create.
    active: { type: Boolean, default: true, index: true },

    // Display order in select menus.
    sortOrder: { type: Number, default: 0 },

    // "system" for seeded types, Discord ID for custom.
    createdBy: { type: String, default: 'system' },

    // Whether High Command can delete it via /settings.
    isDeletable: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'event_types',
  }
);

export const EventType = mongoose.model('EventType', EventTypeSchema);
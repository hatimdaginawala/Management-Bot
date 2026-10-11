import mongoose from 'mongoose';
import { USER_STATUS, QUOTA_CATEGORY } from './enums.js';

const { Schema } = mongoose;

/**
 * Sub-document holding Roblox-owned data.
 * The Roblox sync service is the ONLY writer of these fields.
 */
const RobloxDataSchema = new Schema(
  {
    username: { type: String, trim: true },
    displayName: { type: String, trim: true },
    rankId: { type: Number },
    rankName: { type: String, trim: true },
    rankValue: { type: Number },
    lastSyncedAt: { type: Date },
  },
  { _id: false }
);

/**
 * Application-owned quota override.
 * `exempt` is a manual flag set by High Command.
 * `exemptUntil` bounds it in time (null = no expiry).
 * `exemptReason` is auditable text.
 */
const QuotaSchema = new Schema(
  {
    exempt: { type: Boolean, default: false },
    exemptUntil: { type: Date, default: null },
    exemptReason: { type: String, trim: true, default: null },
    // Cached category for fast quota evaluation.
    // Derived from role assignments at evaluation time, not stored as truth.
    category: {
      type: String,
      enum: Object.values(QUOTA_CATEGORY),
      default: QUOTA_CATEGORY.NONE,
    },
  },
  { _id: false }
);

const UserSchema = new Schema(
  {
    // ----- Discord-owned identity -----
    discordId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    discordUsername: { type: String, trim: true, default: null },

    // ----- Roblox-owned identity -----
    robloxId: {
      type: String,
      // Intentionally NO `default: null`.
      // The `uniq_robloxId_sparse` index treats `null` as a value,
      // which would reject the second user without a linked Roblox account.
      // Omitting the field entirely is what makes the sparse index work.
      trim: true,
    },
    robloxUsername: { type: String, trim: true, default: null },
    roblox: { type: RobloxDataSchema, default: () => ({}) },

    // ----- Application-owned state -----
    status: {
      type: String,
      enum: Object.values(USER_STATUS),
      default: USER_STATUS.UNVERIFIED,
      index: true,
    },
    quota: { type: QuotaSchema, default: () => ({}) },

    // When the user joined the Discord/group context.
    joinedAt: { type: Date, default: Date.now },

    // Historical marker: when did this user last leave Roblox group.
    // Historical marker: when did this user last leave Roblox group.
    lastLeftRobloxAt: { type: Date, default: null },
    lastRejoinedRobloxAt: { type: Date, default: null },

    // When did the user last unlink their Roblox account (D12).
    // Used to enforce the re-link cooldown.
    lastUnlinkedAt: { type: Date, default: null },

    // Suspension / removal metadata.
    suspendedAt: { type: Date, default: null },
    suspensionReason: { type: String, trim: true, default: null },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

/**
 * Roblox ID must be unique when present, but a user may exist
 * without a linked Roblox account. `sparse: true` enforces that.
 */
UserSchema.index(
  { robloxId: 1 },
  {
    unique: true,
    sparse: true,
    name: 'uniq_robloxId_sparse',
  }
);

// Fast filtering for member listings and quota evaluation.
UserSchema.index({ status: 1, 'quota.category': 1 }, { name: 'status_category' });

export const User = mongoose.model('User', UserSchema);
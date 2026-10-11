import mongoose from 'mongoose';
import { QUOTA_CATEGORY } from './enums.js';

const { Schema } = mongoose;

/**
 * What is being counted for a category.
 * STAFF   -> HOSTED_EVENTS
 * LOW_RANK -> ATTENDED_EVENTS
 * Kept as an enum so future metrics (e.g. HOSTED_HOURS) can be added.
 */
export const QUOTA_METRIC = Object.freeze({
  HOSTED_EVENTS: 'HOSTED_EVENTS',
  ATTENDED_EVENTS: 'ATTENDED_EVENTS',
});

/**
 * Granularity of the quota. Only WEEKLY is supported today,
 * but this preserves the door for BIWEEKLY / MONTHLY later.
 */
export const QUOTA_PERIOD_KIND = Object.freeze({
  WEEKLY: 'WEEKLY',
});

const QuotaPolicySchema = new Schema(
  {
    // Which population this applies to.
    category: {
      type: String,
      enum: [QUOTA_CATEGORY.STAFF, QUOTA_CATEGORY.LOW_RANK],
      required: true,
      index: true,
    },

    metric: {
      type: String,
      enum: Object.values(QUOTA_METRIC),
      required: true,
    },

    // Required amount per period.
    amount: { type: Number, required: true, min: 0 },

    period: {
      type: String,
      enum: Object.values(QUOTA_PERIOD_KIND),
      default: QUOTA_PERIOD_KIND.WEEKLY,
      required: true,
    },

    // Policy validity window. A null effectiveTo means "current".
    effectiveFrom: { type: Date, required: true, index: true },
    effectiveTo: { type: Date, default: null, index: true },

    active: { type: Boolean, default: true, index: true },

    // Strike recovery multiplier (D7). Default 2 means "double quota per strike".
    recoveryMultiplier: { type: Number, default: 2, min: 1 },

    // Who created this policy (Discord ID or "system" for seeds).
    createdBy: { type: String, default: 'system', trim: true },

    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'quota_policies',
  }
);

/**
 * At any moment, a category should have exactly ONE active policy.
 * Enforced by partial unique index — only one row per category can be
 * active with no effectiveTo (i.e., "current").
 */
QuotaPolicySchema.index(
  { category: 1, active: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true, effectiveTo: null },
    name: 'uniq_active_policy_per_category',
  }
);

// Fast lookup for "which policy was active at time T".
QuotaPolicySchema.index(
  { category: 1, effectiveFrom: -1 },
  { name: 'category_effectiveFrom_desc' }
);

export const QuotaPolicy = mongoose.model('QuotaPolicy', QuotaPolicySchema);
import mongoose from 'mongoose';
import { QUOTA_CATEGORY, ROLE_KIND } from './enums.js';

const { Schema } = mongoose;

const RoleSchema = new Schema(
  {
    // Stable machine-readable identifier. Used for lookups.
    // Examples: "super_admin", "supreme_command", "staff".
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },

    // Display name, e.g. "Supreme Command".
    name: { type: String, required: true, trim: true },

    description: { type: String, trim: true, default: '' },

    // List of permission keys or wildcards from the Permission catalog.
    // Example: ["events.view", "events.create", "quota.view"].
    permissions: {
      type: [String],
      default: [],
    },

    // Higher priority = higher rank in the hierarchy.
    priority: {
      type: Number,
      required: true,
      default: 0,
      index: true,
    },

    // Which quota category this role contributes to.
    // Only meaningful for Staff (STAFF) and Low Rank (LOW_RANK).
    quotaCategory: {
      type: String,
      enum: Object.values(QUOTA_CATEGORY),
      default: QUOTA_CATEGORY.NONE,
      index: true,
    },

    // System roles are seeded and protected from deletion.
    kind: {
      type: String,
      enum: Object.values(ROLE_KIND),
      default: ROLE_KIND.CUSTOM,
      index: true,
    },

    // Only super_admin has isPermanent = true.
    isPermanent: { type: Boolean, default: false },

    // Cannot be edited (permissions/priority). Typically true for super_admin.
    isEditable: { type: Boolean, default: true },

    // Cannot be deleted. True for all seeded roles by default.
    isDeletable: { type: Boolean, default: true },

    active: { type: Boolean, default: true, index: true },

    // Who created this role (Discord ID or "system" for seeds).
    createdBy: { type: String, default: 'system' },
  },
  {
    timestamps: true,
    collection: 'roles',
  }
);

/**
 * `key` is globally unique. `name` is not enforced unique to allow
 * future renaming of display names without breaking references.
 */

export const Role = mongoose.model('Role', RoleSchema);
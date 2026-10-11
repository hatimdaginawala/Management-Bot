import mongoose from 'mongoose';

const { Schema } = mongoose;

const RoleAssignmentSchema = new Schema(
  {
    // Reference to User._id (not discordId) for referential integrity.
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Snapshot the discordId for fast querying without a populate.
    discordId: { type: String, required: true, index: true, trim: true },

    role: {
      type: Schema.Types.ObjectId,
      ref: 'Role',
      required: true,
      index: true,
    },
    // Snapshot the role key for fast querying without a populate.
    roleKey: { type: String, required: true, index: true, trim: true },

    assignedBy: {
      type: String,
      required: true,
      trim: true,
      default: 'system',
    },

    assignedAt: { type: Date, default: Date.now },

    // Null = active assignment.
    removedAt: { type: Date, default: null },
    removedBy: { type: String, default: null },

    // Reason text (optional, for auditing manual assignments/removals).
    reason: { type: String, trim: true, default: null },

    active: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    collection: 'role_assignments',
  }
);

/**
 * A user may only have ONE ACTIVE assignment per role.
 * Removed (soft-deleted) assignments are kept for history.
 */
RoleAssignmentSchema.index(
  { user: 1, role: 1, active: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
    name: 'uniq_active_user_role',
  }
);

// Fast: "give me all active roles for this user".
RoleAssignmentSchema.index(
  { user: 1, active: 1 },
  { name: 'user_active' }
);

// Fast: "give me all users holding this role".
RoleAssignmentSchema.index(
  { role: 1, active: 1 },
  { name: 'role_active' }
);

export const RoleAssignment = mongoose.model(
  'RoleAssignment',
  RoleAssignmentSchema
);
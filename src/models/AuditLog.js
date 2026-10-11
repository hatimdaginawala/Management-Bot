import mongoose from 'mongoose';
import { AUDIT_CATEGORY } from './enums.js';

const { Schema } = mongoose;

const AuditLogSchema = new Schema(
  {
    // Who performed the action. Discord ID or "system".
    actorId: { type: String, required: true, index: true, trim: true },

    // Machine-readable action verb, e.g. "role.created", "event.approved".
    action: { type: String, required: true, index: true, trim: true },

    // Coarse grouping for filtering: USER, ROLE, EVENT, etc.
    category: {
      type: String,
      enum: Object.values(AUDIT_CATEGORY),
      required: true,
      index: true,
    },

    // What kind of thing was acted upon.
    targetType: {
      type: String,
      required: true,
      trim: true,
      // e.g. "User", "Role", "Event", "Settings"
    },
    targetId: { type: String, default: null, trim: true, index: true },

    // Optional snapshot of the target before the change.
    before: { type: Schema.Types.Mixed, default: null },
    // Optional snapshot of the target after the change.
    after: { type: Schema.Types.Mixed, default: null },

    // Free-text reason, when supplied.
    reason: { type: String, trim: true, default: null },

    // Optional related context (e.g. a quota period key).
    context: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'audit_logs',
    // Append-only: forbid updates via Mongoose middleware.
  }
);

/**
 * Fast: recent activity for a specific actor.
 */
AuditLogSchema.index(
  { actorId: 1, createdAt: -1 },
  { name: 'actor_created_desc' }
);

/**
 * Fast: recent activity by category (e.g. all ROLE changes).
 */
AuditLogSchema.index(
  { category: 1, createdAt: -1 },
  { name: 'category_created_desc' }
);

/**
 * Fast: history of a specific target document.
 */
AuditLogSchema.index(
  { targetType: 1, targetId: 1, createdAt: -1 },
  { name: 'target_created_desc' }
);

// Strict append-only: block document updates at the Mongoose layer.
AuditLogSchema.pre('updateOne', function blockUpdate(next) {
  next(new Error('AuditLog is append-only; updates are forbidden.'));
});
AuditLogSchema.pre('updateMany', function blockUpdate(next) {
  next(new Error('AuditLog is append-only; bulk updates are forbidden.'));
});
AuditLogSchema.pre('findOneAndUpdate', function blockUpdate(next) {
  next(new Error('AuditLog is append-only; findOneAndUpdate is forbidden.'));
});
AuditLogSchema.pre('replaceOne', function blockUpdate(next) {
  next(new Error('AuditLog is append-only; replaceOne is forbidden.'));
});
AuditLogSchema.pre('deleteOne', function blockDelete(next) {
  next(new Error('AuditLog is append-only; deletes are forbidden.'));
});
AuditLogSchema.pre('deleteMany', function blockDelete(next) {
  next(new Error('AuditLog is append-only; bulk deletes are forbidden.'));
});

export const AuditLog = mongoose.model('AuditLog', AuditLogSchema);
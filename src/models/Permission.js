import mongoose from 'mongoose';

const { Schema } = mongoose;

const PermissionSchema = new Schema(
  {
    // Unique permission key, e.g. "events.create".
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    // Human-readable label for UI/docs.
    label: { type: String, required: true, trim: true },
    // Short description.
    description: { type: String, trim: true, default: '' },
    // Grouping for display (matches the RBAC spec sections).
    category: { type: String, required: true, trim: true, index: true },
    // Wildcards like "events.*" are stored as explicit strings;
    // the resolver expands them at evaluation time.
    isWildcard: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'permissions',
  }
);

export const Permission = mongoose.model('Permission', PermissionSchema);
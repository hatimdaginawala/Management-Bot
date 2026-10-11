import mongoose from 'mongoose';
import { VERIFICATION_STATUS } from './enums.js';

const { Schema } = mongoose;

const VerificationSchema = new Schema(
  {
    discordId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    // The Roblox username the user claimed in /link.
    // Stored so we can look it up before we know the robloxId.
    robloxUsername: { type: String, trim: true, required: true },

    // Populated once we resolve the account.
    robloxId: { type: String, default: null, trim: true, index: true },

    // Crypto-random code the user must paste in their Roblox About.
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    status: {
      type: String,
      enum: Object.values(VERIFICATION_STATUS),
      default: VERIFICATION_STATUS.PENDING,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true, // for TTL-like expiration sweep
    },
    verifiedAt: { type: Date, default: null },

    // Failed attempts counter (rate-limit / brute-force protection).
    attempts: { type: Number, default: 0, min: 0 },

    // Reason for failure or cancellation (auditable).
    failureReason: { type: String, trim: true, default: null },

    // IP/Discord context for auditing — optional.
    initiatedFrom: {
      type: String,
      enum: ['DISCORD', 'REST'],
      default: 'DISCORD',
    },
  },
  {
    timestamps: true,
    collection: 'verifications',
  }
);

/**
 * A user should not have more than one PENDING verification.
 * Enforced via partial unique index (MongoDB supports `partialFilterExpression`).
 */
VerificationSchema.index(
  { discordId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: VERIFICATION_STATUS.PENDING },
    name: 'uniq_pending_per_user',
  }
);

/**
 * Sweep index for the expiration job:
 * PENDING records past expiresAt need to be flipped to EXPIRED.
 */
VerificationSchema.index(
  { status: 1, expiresAt: 1 },
  { name: 'status_expiresAt' }
);

export const Verification = mongoose.model('Verification', VerificationSchema);
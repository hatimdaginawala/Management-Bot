import { QuotaPolicy } from '../models/index.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';
import logger from '../config/logger.js';

const VALID_CATEGORIES = ['STAFF', 'LOW_RANK'];
const DEFAULT_METRICS = {
  STAFF: 'HOSTED_EVENTS',
  LOW_RANK: 'ATTENDED_EVENTS',
};

/**
 * Quota policy service.
 *
 * Policies are versioned by `effectiveFrom` / `effectiveTo`:
 *   - The current open policy for a category has `effectiveTo: null`.
 *   - Setting a new policy closes the current one (`effectiveTo = now`)
 *     and creates a new one. Historical `QuotaPeriod.policies` snapshots
 *     are unaffected.
 *
 * A category may have exactly one "open" policy at a time — enforced by
 * a partial-unique index (`uniq_active_policy_per_category`).
 */

export async function getActivePolicyForCategory(category) {
  assertCategory(category);
  return QuotaPolicy.findOne({
    category,
    active: true,
    effectiveTo: null,
  }).lean();
}

export async function listPolicies({ category, includeExpired = true } = {}) {
  const filter = {};
  if (category) filter.category = category;
  if (!includeExpired) filter.effectiveTo = null;
  return QuotaPolicy.find(filter).sort({ category: 1, effectiveFrom: -1 }).lean();
}

/**
 * Set a new policy for a category.
 * Closes the current open policy (if any) and creates a new one.
 * Idempotent in spirit: calling with the same `amount` closes and
 * reopens; the semantics are "latest wins".
 */
export async function setPolicy(actorId, {
  category,
  amount,
  metric = null,
  recoveryMultiplier = 2,
  effectiveFrom = null,
  notes = '',
}) {
  assertCategory(category);
  if (typeof amount !== 'number' || amount < 0) {
    throw new ValidationError('amount must be a non-negative number.');
  }
  if (typeof recoveryMultiplier !== 'number' || recoveryMultiplier < 1) {
    throw new ValidationError('recoveryMultiplier must be >= 1.');
  }

  const metricValue = metric ?? DEFAULT_METRICS[category];
  const now = effectiveFrom ?? new Date();

  // Close any existing open policy for this category.
  const closed = await QuotaPolicy.findOneAndUpdate(
    { category, active: true, effectiveTo: null },
    { $set: { effectiveTo: now, active: false } },
    { new: true }
  );

  // Create the new open policy.
  let created;
  try {
    created = await QuotaPolicy.create({
      category,
      metric: metricValue,
      amount,
      period: 'WEEKLY',
      effectiveFrom: now,
      effectiveTo: null,
      active: true,
      recoveryMultiplier,
      createdBy: actorId,
      notes,
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError(
        'Another open policy for this category already exists. Retry.'
      );
    }
    throw err;
  }

  await audit({
    actorId,
    action: 'quota.policy_set',
    category: 'QUOTA',
    targetType: 'QuotaPolicy',
    targetId: created._id,
    before: closed
      ? { policyId: closed._id, amount: closed.amount, effectiveFrom: closed.effectiveFrom }
      : null,
    after: {
      policyId: created._id,
      category,
      amount,
      metric: metricValue,
      recoveryMultiplier,
    },
  });

  logger.info(
    { actorId, category, amount, metric: metricValue, closedPolicyId: closed?._id },
    'Quota policy set'
  );

  return created;
}

export async function getPolicyById(id) {
  const p = await QuotaPolicy.findById(id).lean();
  if (!p) throw new NotFoundError('Quota policy', { id: String(id) });
  return p;
}

function assertCategory(category) {
  if (!VALID_CATEGORIES.includes(category)) {
    throw new ValidationError(`Invalid quota category: ${category}`);
  }
}
import * as quotaPolicyRepo from '../db/repositories/quotaPolicy.repository.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';
import { db } from '../db/client.js';
import logger from '../config/logger.js';

/**
 * Quota policy service. Public API unchanged.
 *
 * Setting a new policy closes the previous one and creates a new open
 * one, inside a transaction so the two writes are atomic.
 */

const VALID_CATEGORIES = ['STAFF', 'LOW_RANK'];
const DEFAULT_METRICS = {
  STAFF: 'HOSTED_EVENTS',
  LOW_RANK: 'ATTENDED_EVENTS',
};

export async function getActivePolicyForCategory(category) {
  assertCategory(category);
  return quotaPolicyRepo.findActiveForCategory(category);
}

export async function listPolicies({ category, includeExpired = true } = {}) {
  return quotaPolicyRepo.list({ category, includeExpired });
}

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

  const result = await db.transaction(async (trx) => {
    // Close the current open policy, if any.
    const closedId = await quotaPolicyRepo.closeOpenForCategory(category, now, trx);

    // Create the new open policy.
    const created = await quotaPolicyRepo.create({
      category,
      metric: metricValue,
      amount,
      effectiveFrom: now,
      recoveryMultiplier,
      createdBy: actorId,
      notes,
    }, trx);

    return { closedId, created };
  });

  await audit({
    actorId,
    action: 'quota.policy_set',
    category: 'QUOTA',
    targetType: 'QuotaPolicy',
    targetId: result.created.id,
    before: result.closedId ? { policyId: result.closedId } : null,
    after: {
      policyId: result.created.id,
      category,
      amount,
      metric: metricValue,
      recoveryMultiplier,
    },
  });

  logger.info(
    {
      actorId,
      category,
      amount,
      metric: metricValue,
      closedPolicyId: result.closedId,
    },
    'Quota policy set'
  );

  return result.created;
}

export async function getPolicyById(id) {
  const p = await quotaPolicyRepo.findById(id);
  if (!p) throw new NotFoundError('Quota policy', { id: String(id) });
  return p;
}

function assertCategory(category) {
  if (!VALID_CATEGORIES.includes(category)) {
    throw new ValidationError('Invalid quota category: ' + category);
  }
}
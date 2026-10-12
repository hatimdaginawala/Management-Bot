import { db, convertRow, convertRows, withDbErrors } from '../helpers.js';

const CTX = { repository: 'verification' };

export async function findById(id) {
  return withDbErrors(async () => {
    const row = await db('verifications').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'findById' });
}

export async function findPendingByDiscordId(discordId) {
  return withDbErrors(async () => {
    const row = await db('verifications')
      .where({ discord_id: discordId, status: 'PENDING' })
      .orderBy('created_at', 'desc')
      .first();
    return convertRow(row);
  }, { ...CTX, method: 'findPendingByDiscordId' });
}

export async function findByCode(code) {
  return withDbErrors(async () => {
    const row = await db('verifications').where({ code }).first();
    return convertRow(row);
  }, { ...CTX, method: 'findByCode' });
}

/**
 * Create a verification row. Duplicate code throws ConflictError.
 */
export async function create(data) {
  return withDbErrors(async () => {
    const [id] = await db('verifications').insert({
      discord_id: data.discordId,
      roblox_username: data.robloxUsername,
      roblox_id: data.robloxId ?? null,
      code: data.code,
      status: data.status ?? 'PENDING',
      expires_at: data.expiresAt,
      attempts: data.attempts ?? 0,
      initiated_from: data.initiatedFrom ?? 'DISCORD',
    });
    const row = await db('verifications').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'create' });
}

/**
 * Update fields on a verification by ID.
 */
export async function updateById(id, data) {
  return withDbErrors(async () => {
    const patch = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.robloxId !== undefined) patch.roblox_id = data.robloxId;
    if (data.attempts !== undefined) patch.attempts = data.attempts;
    if (data.verifiedAt !== undefined) patch.verified_at = data.verifiedAt;
    if (data.failureReason !== undefined) patch.failure_reason = data.failureReason;

    if (Object.keys(patch).length > 0) {
      await db('verifications').where({ id }).update(patch);
    }
    const row = await db('verifications').where({ id }).first();
    return convertRow(row);
  }, { ...CTX, method: 'updateById' });
}

/**
 * Cancel any existing PENDING verification for a Discord user.
 * Used before creating a new one.
 */
export async function cancelPendingFor(discordId, reason = null) {
  return withDbErrors(async () => {
    const affected = await db('verifications')
      .where({ discord_id: discordId, status: 'PENDING' })
      .update({
        status: 'CANCELLED',
        failure_reason: reason,
      });
    return affected;
  }, { ...CTX, method: 'cancelPendingFor' });
}

/**
 * Cancel a PENDING verification by code.
 */
export async function cancelByCode(code, reason = null) {
  return withDbErrors(async () => {
    const affected = await db('verifications')
      .where({ code, status: 'PENDING' })
      .update({
        status: 'CANCELLED',
        failure_reason: reason,
      });
    return affected;
  }, { ...CTX, method: 'cancelByCode' });
}

/**
 * Mark any PENDING verifications past their expiry as EXPIRED.
 * Returns the number affected.
 */
export async function expireDue(asOf = new Date()) {
  return withDbErrors(async () => {
    const affected = await db('verifications')
      .where({ status: 'PENDING' })
      .where('expires_at', '<=', asOf)
      .update({
        status: 'EXPIRED',
        failure_reason: 'Code expired (sweep)',
      });
    return affected;
  }, { ...CTX, method: 'expireDue' });
}

/**
 * Delete terminal-state verifications older than a cutoff.
 * Used by the cleanup job.
 */
export async function deleteOldTerminal(cutoff) {
  return withDbErrors(async () => {
    const affected = await db('verifications')
      .whereIn('status', ['CANCELLED', 'FAILED', 'EXPIRED'])
      .where('created_at', '<=', cutoff)
      .delete();
    return affected;
  }, { ...CTX, method: 'deleteOldTerminal' });
}

/**
 * Check whether a PENDING verification exists for a Discord user.
 * (Service-level equivalent of the partial-unique index.)
 */
export async function hasPending(discordId) {
  return withDbErrors(async () => {
    const row = await db('verifications')
      .where({ discord_id: discordId, status: 'PENDING' })
      .first();
    return Boolean(row);
  }, { ...CTX, method: 'hasPending' });
}
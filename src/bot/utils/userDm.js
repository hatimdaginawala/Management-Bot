import { EmbedBuilder } from 'discord.js';
import * as settingsService from '../../services/settings.service.js';
import { COLORS } from '../embedBuilders.js';
import logger from '../../config/logger.js';

/**
 * Send a user-facing notification DM.
 *
 * Contract:
 *   - Respects settings.notifications.dmAffectedUser (skips when disabled)
 *   - Never throws. DM failures are logged and swallowed.
 *   - Uses Discord locale-aware timestamps (<t:...>)
 *   - Uses mentions (<@id>) — callers must pass pre-formatted field values
 *
 * @param {Client} client
 * @param {object} opts
 * @param {string} opts.discordId
 * @param {string} opts.title
 * @param {number} [opts.color]      Defaults to COLORS.INFO
 * @param {string} [opts.description]
 * @param {Array}  [opts.fields]     Array of { name, value, inline? }
 */
export async function sendUserDm(client, {
  discordId,
  title,
  color = COLORS.INFO,
  description = null,
  fields = [],
} = {}) {
  try {
    if (!client || !discordId) {
      logger.debug({ discordId: discordId || null }, 'userDm: missing client or discordId');
      return;
    }

    const settings = await settingsService.getSettings();
    const dmEnabled = settings?.notifications?.dmAffectedUser ?? true;
    if (!dmEnabled) {
      logger.debug({ discordId }, 'userDm skipped: dmAffectedUser disabled');
      return;
    }

    const user = await client.users.fetch(discordId).catch((err) => {
      logger.debug({ discordId, err: err.message }, 'userDm: could not fetch user');
      return null;
    });
    if (!user) {
      logger.warn({ discordId, title }, 'userDm: user fetch failed');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setTimestamp(new Date());

    if (description) embed.setDescription(description);
    if (fields.length > 0) embed.addFields(fields.slice(0, 25));

    await user.send({ embeds: [embed] });
    logger.info({ discordId, title }, 'User DM sent');
  } catch (err) {
    logger.warn(
      { err: err.message, discordId, title },
      'userDm failed (user may have DMs closed)'
    );
  }
}

// ============================================================
//  Convenience wrappers for each notification type
// ============================================================

/**
 * "You received a notice" — called after createNotice.
 */
export async function dmNoticeCreated(client, notice, { actorId = null } = {}) {
  const fields = [
    { name: 'Type', value: '`' + notice.type + '`', inline: true },
    { name: 'Reason', value: (notice.reason || '—').slice(0, 1000), inline: false },
  ];

  if (notice.endAt) {
    const endTs = Math.floor(new Date(notice.endAt).getTime() / 1000);
    fields.push({ name: 'Ends', value: '<t:' + endTs + ':d>', inline: true });
  } else {
    fields.push({ name: 'Ends', value: 'Open-ended', inline: true });
  }

  if (notice.grantsQuotaExemption) {
    fields.push({
      name: 'Quota Impact',
      value: '🟢 You are exempt from weekly quota while this notice is active.',
      inline: false,
    });
  }

  if (actorId) {
    fields.push({ name: 'Issued By', value: '<@' + actorId + '>', inline: true });
  }

  await sendUserDm(client, {
    discordId: notice.discordId,
    title: 'Notice Issued',
    color: COLORS.WARNING,
    fields,
  });
}

/**
 * "Your notice was cancelled"
 */
export async function dmNoticeCancelled(client, notice, { actorId = null, reason = null } = {}) {
  const fields = [
    { name: 'Type', value: '`' + notice.type + '`', inline: true },
  ];

  if (reason) {
    fields.push({ name: 'Cancellation Reason', value: reason.slice(0, 1000), inline: false });
  }

  if (actorId) {
    fields.push({ name: 'Cancelled By', value: '<@' + actorId + '>', inline: true });
  }

  await sendUserDm(client, {
    discordId: notice.discordId,
    title: 'Notice Cancelled',
    color: COLORS.INFO,
    description: 'A notice on your record has been cancelled.',
    fields,
  });
}

/**
 * "You're now exempt from quota"
 */
export async function dmExemptionGranted(client, targetDiscordId, { reason, exemptUntil = null, actorId = null } = {}) {
  const fields = [
    { name: 'Reason', value: (reason || '—').slice(0, 1000), inline: false },
  ];

  if (exemptUntil) {
    const ts = Math.floor(new Date(exemptUntil).getTime() / 1000);
    fields.push({ name: 'Exempt Until', value: '<t:' + ts + ':d>', inline: true });
  } else {
    fields.push({ name: 'Exempt Until', value: 'Permanent (until revoked)', inline: true });
  }

  if (actorId) {
    fields.push({ name: 'Granted By', value: '<@' + actorId + '>', inline: true });
  }

  await sendUserDm(client, {
    discordId: targetDiscordId,
    title: 'Quota Exemption Granted',
    color: COLORS.SUCCESS,
    description: 'You are now exempt from weekly quota requirements.',
    fields,
  });
}

/**
 * "Your exemption was revoked"
 */
export async function dmExemptionRevoked(client, targetDiscordId, { reason = null, actorId = null } = {}) {
  const fields = [];
  if (reason) fields.push({ name: 'Reason', value: reason.slice(0, 1000), inline: false });
  if (actorId) fields.push({ name: 'Revoked By', value: '<@' + actorId + '>', inline: true });

  await sendUserDm(client, {
    discordId: targetDiscordId,
    title: 'Quota Exemption Revoked',
    color: COLORS.WARNING,
    description: 'Your weekly quota exemption has been removed. You are once again subject to weekly quota.',
    fields,
  });
}

/**
 * "You received a strike" — covers QUOTA_MISSED (system) and MANUAL.
 */
export async function dmStrikeIssued(client, strike, { actorId = null } = {}) {
  const fields = [
    { name: 'Type', value: '`' + strike.type + '`', inline: true },
    { name: 'Reason', value: (strike.reason || '—').slice(0, 1000), inline: false },
  ];

  if (strike.quotaPeriodKey) {
    fields.push({ name: 'Quota Period', value: '`' + strike.quotaPeriodKey + '`', inline: true });
  }

  if (strike.issuedAt) {
    const ts = Math.floor(new Date(strike.issuedAt).getTime() / 1000);
    fields.push({ name: 'Issued', value: '<t:' + ts + ':f>', inline: true });
  }

  if (actorId && actorId !== 'system') {
    fields.push({ name: 'Issued By', value: '<@' + actorId + '>', inline: true });
  }

  await sendUserDm(client, {
    discordId: strike.discordId,
    title: 'Strike Issued',
    color: COLORS.ERROR,
    description: 'A strike has been added to your record. You can remove it through double-quota recovery or by appealing to High Command.',
    fields,
  });
}

/**
 * "A strike was removed / recovered"
 */
export async function dmStrikeResolved(client, strike, {
  resolvedAs,
  reason = null,
  actorId = null,
} = {}) {
  const fields = [
    { name: 'Type', value: '`' + strike.type + '`', inline: true },
    { name: 'Resolution', value: '`' + resolvedAs + '`', inline: true },
  ];

  if (strike.quotaPeriodKey) {
    fields.push({ name: 'Quota Period', value: '`' + strike.quotaPeriodKey + '`', inline: true });
  }

  if (reason) {
    fields.push({ name: 'Reason', value: reason.slice(0, 1000), inline: false });
  }

  if (actorId && actorId !== 'system') {
    fields.push({ name: 'Resolved By', value: '<@' + actorId + '>', inline: true });
  }

  const title = resolvedAs === 'RECOVERED' ? 'Strike Recovered' : 'Strike Removed';
  const description = resolvedAs === 'RECOVERED'
    ? 'One of your active strikes has been recovered through double-quota activity. Well done.'
    : 'One of your strikes has been removed.';

  await sendUserDm(client, {
    discordId: strike.discordId,
    title,
    color: COLORS.SUCCESS,
    description,
    fields,
  });
}

/**
 * "You've reached the removal threshold" — fired when createFromThreshold returns created:true.
 */
export async function dmRemovalRequested(client, removalRequest, { actorId = null } = {}) {
  const fields = [
    { name: 'Active Strikes', value: String(removalRequest.strikeCount), inline: true },
    { name: 'Threshold', value: String(removalRequest.strikeThreshold), inline: true },
  ];

  if (removalRequest.description) {
    fields.push({ name: 'Reason', value: removalRequest.description.slice(0, 1000), inline: false });
  }

  if (actorId && actorId !== 'system') {
    fields.push({ name: 'Requested By', value: '<@' + actorId + '>', inline: true });
  }

  await sendUserDm(client, {
    discordId: removalRequest.discordId,
    title: 'Pending Removal Created',
    color: COLORS.ERROR,
    description:
      'Your active strike count has reached the removal threshold. ' +
      'A pending removal request has been created and will be reviewed by High Command. ' +
      'You will be notified of the decision.',
    fields,
  });
}

/**
 * "Removal approved"
 */
export async function dmRemovalApproved(client, removalRequest, { actorId = null, effectiveAt = null, reason = null } = {}) {
  const fields = [];

  if (effectiveAt) {
    const ts = Math.floor(new Date(effectiveAt).getTime() / 1000);
    fields.push({ name: 'Effective Date', value: '<t:' + ts + ':f>', inline: true });
  }

  if (reason) {
    fields.push({ name: 'Reviewer Reason', value: reason.slice(0, 1000), inline: false });
  }

  if (actorId) {
    fields.push({ name: 'Approved By', value: '<@' + actorId + '>', inline: true });
  }

  await sendUserDm(client, {
    discordId: removalRequest.discordId,
    title: 'Removal Approved',
    color: COLORS.ERROR,
    description:
      'A removal request against you has been approved. ' +
      'You will be marked as having left the group on the effective date. ' +
      'Contact High Command if you believe this is an error.',
    fields,
  });
}

/**
 * "Removal dismissed"
 */
export async function dmRemovalDismissed(client, removalRequest, { actorId = null, reason = null } = {}) {
  const fields = [];

  if (reason) {
    fields.push({ name: 'Reason', value: reason.slice(0, 1000), inline: false });
  }

  if (actorId) {
    fields.push({ name: 'Dismissed By', value: '<@' + actorId + '>', inline: true });
  }

  await sendUserDm(client, {
    discordId: removalRequest.discordId,
    title: 'Removal Dismissed',
    color: COLORS.SUCCESS,
    description:
      'The removal request against you has been dismissed. ' +
      'Your current strikes remain, but you are not being removed from the group.',
    fields,
  });
}
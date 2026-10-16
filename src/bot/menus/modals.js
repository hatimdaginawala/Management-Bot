// src/bot/menus/modals.js

import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

/**
 * Central registry of modal builders, keyed by customId.
 *
 * Exact keys match directly. Keys ending in `:*` act as prefixes —
 * the suffix is passed to the builder as its second argument.
 *
 * Every entry must return a FRESH ModalBuilder — modals are consumed
 * by showModal() and cannot be reused.
 */
export const MODAL_BUILDERS = Object.freeze({
  'modal:event-create': () => buildEventCreateModal(),
  'modal:quota-set': () => buildQuotaSetModal(),
  'modal:leave-create': () => buildLeaveCreateModal(),
  'modal:role-create': () => buildRoleCreateModal(),
  'modal:report-generate': () => buildReportGenerateModal(),
  'modal:role-edit:*': (suffix) => buildRoleEditModal(suffix),
});

export function buildModal(customId) {
  if (MODAL_BUILDERS[customId]) {
    return MODAL_BUILDERS[customId]();
  }

  // Prefix match: find the longest registered key ending in ':*' that matches.
  let bestKey = null;
  let bestPrefixLen = -1;
  for (const key of Object.keys(MODAL_BUILDERS)) {
    if (!key.endsWith(':*')) continue;
    const prefix = key.slice(0, -1); // keep trailing ':'
    if (customId.startsWith(prefix) && prefix.length > bestPrefixLen) {
      bestKey = key;
      bestPrefixLen = prefix.length;
    }
  }

  if (bestKey) {
    const suffix = customId.slice(bestPrefixLen);
    return MODAL_BUILDERS[bestKey](suffix);
  }

  throw new Error('No modal builder registered for ' + customId);
}

// ============================================================
//  Event — Create
// ============================================================
function buildEventCreateModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal:event-create')
    .setTitle('Log New Event');

  const typeInput = new TextInputBuilder()
    .setCustomId('eventTypeKey')
    .setLabel('Event type')
    .setPlaceholder('patrol, ct, dt, raid, tryout, other')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const attendeesInput = new TextInputBuilder()
    .setCustomId('attendees')
    .setLabel('Attendees')
    .setPlaceholder('Discord IDs or Roblox usernames, comma-separated')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);

  const proofInput = new TextInputBuilder()
    .setCustomId('proofUrl')
    .setLabel('Proof URL')
    .setPlaceholder('https://...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(500);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes (optional)')
    .setPlaceholder('Any additional context')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(typeInput),
    new ActionRowBuilder().addComponents(attendeesInput),
    new ActionRowBuilder().addComponents(proofInput),
    new ActionRowBuilder().addComponents(notesInput)
  );

  return modal;
}

// ============================================================
//  Quota — Set
// ============================================================
function buildQuotaSetModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal:quota-set')
    .setTitle('Set Quota Policy');

  const categoryInput = new TextInputBuilder()
    .setCustomId('category')
    .setLabel('Category')
    .setPlaceholder('STAFF or LOW_RANK')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);

  const amountInput = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('Required amount per week')
    .setPlaceholder('e.g. 5')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3);

  const recoveryInput = new TextInputBuilder()
    .setCustomId('recoveryMultiplier')
    .setLabel('Recovery multiplier (default 2)')
    .setPlaceholder('2')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes (optional)')
    .setPlaceholder('Reason for change')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(categoryInput),
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(recoveryInput),
    new ActionRowBuilder().addComponents(notesInput)
  );

  return modal;
}

// ============================================================
//  Leave — Create
// ============================================================
function buildLeaveCreateModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal:leave-create')
    .setTitle('Submit Leave Request');

  const startInput = new TextInputBuilder()
    .setCustomId('startAt')
    .setLabel('Start date (YYYY-MM-DD)')
    .setPlaceholder('e.g. 2026-10-15')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10);

  const endInput = new TextInputBuilder()
    .setCustomId('endAt')
    .setLabel('End date (YYYY-MM-DD)')
    .setPlaceholder('e.g. 2026-10-22')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10);

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason')
    .setPlaceholder('Why you need leave')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(startInput),
    new ActionRowBuilder().addComponents(endInput),
    new ActionRowBuilder().addComponents(reasonInput)
  );

  return modal;
}

// ============================================================
//  Role — Create
// ============================================================
function buildRoleCreateModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal:role-create')
    .setTitle('Create Role');

  const keyInput = new TextInputBuilder()
    .setCustomId('key')
    .setLabel('Role key')
    .setPlaceholder('lowercase_snake_case (e.g. event_manager)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(41);

  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Display name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);

  const priorityInput = new TextInputBuilder()
    .setCustomId('priority')
    .setLabel('Priority (0-999)')
    .setPlaceholder('e.g. 20')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3);

  const quotaInput = new TextInputBuilder()
    .setCustomId('quotaCategory')
    .setLabel('Quota category')
    .setPlaceholder('NONE, STAFF, or LOW_RANK')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  modal.addComponents(
    new ActionRowBuilder().addComponents(keyInput),
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(priorityInput),
    new ActionRowBuilder().addComponents(quotaInput)
  );

  return modal;
}

// ============================================================
//  Role — Edit (prefix: modal:role-edit:*)
// ============================================================
function buildRoleEditModal(roleKey) {
  const safeKey = String(roleKey || '').slice(0, 30);

  const modal = new ModalBuilder()
    .setCustomId('modal:role-edit:' + roleKey)
    .setTitle('Edit Role: ' + safeKey);

  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Display name (blank to keep current)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(80);

  const descInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description (blank to keep current)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  const priorityInput = new TextInputBuilder()
    .setCustomId('priority')
    .setLabel('Priority (blank to keep current)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(3);

  const quotaInput = new TextInputBuilder()
    .setCustomId('quotaCategory')
    .setLabel('Quota category (blank to keep current)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(descInput),
    new ActionRowBuilder().addComponents(priorityInput),
    new ActionRowBuilder().addComponents(quotaInput)
  );

  return modal;
}

// ============================================================
//  Report — Manual
// ============================================================
function buildReportGenerateModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal:report-generate')
    .setTitle('Generate Manual Report');

  const fromInput = new TextInputBuilder()
    .setCustomId('from')
    .setLabel('From (YYYY-MM-DD)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10);

  const toInput = new TextInputBuilder()
    .setCustomId('to')
    .setLabel('To (YYYY-MM-DD)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10);

  const labelInput = new TextInputBuilder()
    .setCustomId('label')
    .setLabel('Label (optional)')
    .setPlaceholder('e.g. "October ceremony review"')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(80);

  modal.addComponents(
    new ActionRowBuilder().addComponents(fromInput),
    new ActionRowBuilder().addComponents(toInput),
    new ActionRowBuilder().addComponents(labelInput)
  );

  return modal;
}
// src/bot/selectMenus/auditPickEntry.js
export const customId = 'audit:pick:entry';
export const meta = {};

export async function execute(interaction, ctx) {
  const entryId = interaction.values[0];
  const { HANDLERS } = await import('../commands/audit.js');
  return HANDLERS.entry(interaction, ctx, { entryId });
}
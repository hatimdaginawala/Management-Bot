// src/bot/selectMenus/rolePickEdit.js
export const customId = 'role-picker:edit';
export const meta = {};

export async function execute(interaction, ctx) {
  const roleKey = interaction.values[0];
  const { HANDLERS } = await import('../commands/roles.js');
  return HANDLERS.edit(interaction, ctx, { roleKey });
}
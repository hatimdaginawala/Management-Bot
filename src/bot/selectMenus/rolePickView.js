// src/bot/selectMenus/rolePickView.js
export const customId = 'role-picker:view';
export const meta = {};

export async function execute(interaction, ctx) {
  const roleKey = interaction.values[0];
  const { HANDLERS } = await import('../commands/roles.js');
  return HANDLERS.view(interaction, ctx, { roleKey });
}
// src/bot/selectMenus/rolePickPermissions.js
export const customId = 'role-picker:permissions';
export const meta = {};

export async function execute(interaction, ctx) {
  const roleKey = interaction.values[0];
  const { HANDLERS } = await import('../commands/roles.js');
  return HANDLERS.permissions(interaction, ctx, { roleKey });
}
// src/bot/selectMenus/memberPickRole.js
export const customId = 'member:pick-role';
export const meta = {};

export async function execute(interaction, ctx) {
  const roleKey = interaction.values[0];
  const { HANDLERS } = await import('../commands/members.js');
  return HANDLERS.role(interaction, ctx, { roleKey });
}
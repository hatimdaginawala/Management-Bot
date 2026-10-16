// src/bot/selectMenus/memberPickRank.js
export const customId = 'member:pick-rank';
export const meta = {};

export async function execute(interaction, ctx) {
  const rankName = interaction.values[0];
  const { HANDLERS } = await import('../commands/members.js');
  return HANDLERS.rank(interaction, ctx, { rankName });
}
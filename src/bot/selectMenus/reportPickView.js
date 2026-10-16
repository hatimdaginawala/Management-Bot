// src/bot/selectMenus/reportPickView.js
export const customId = 'report:pick:view';
export const meta = {};

export async function execute(interaction, ctx) {
  const reportId = interaction.values[0];
  const { HANDLERS } = await import('../commands/report.js');
  return HANDLERS.view(interaction, ctx, { reportId });
}
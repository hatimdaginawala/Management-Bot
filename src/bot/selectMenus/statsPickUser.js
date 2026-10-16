// src/bot/selectMenus/statsPickUser.js
export const customId = 'stats:pick-user';
export const meta = {};

export async function execute(interaction, ctx) {
  const userDiscordId = interaction.values[0];
  const target = await interaction.client.users.fetch(userDiscordId).catch(() => null);
  if (!target) {
    return interaction.update({ content: 'User not found.', embeds: [], components: [] });
  }

  const { HANDLERS } = await import('../commands/stats.js');
  return HANDLERS.user(interaction, ctx, { user: target });
}
// src/bot/selectMenus/noticePickUser.js
export const customId = 'notice:pick-user:view';
export const meta = {};

export async function execute(interaction, ctx) {
  const userDiscordId = interaction.values[0];
  const target = await interaction.client.users.fetch(userDiscordId).catch(() => null);
  if (!target) {
    return interaction.update({ content: 'User not found.', embeds: [], components: [] });
  }

  const { HANDLERS } = await import('../commands/notice.js');
  return HANDLERS.view(interaction, ctx, { user: target });
}
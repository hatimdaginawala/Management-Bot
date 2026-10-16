// src/bot/selectMenus/memberPickUser.js
export const customId = 'member:pick-user:view';
export const meta = {};

export async function execute(interaction, ctx) {
  const userDiscordId = interaction.values[0];
  const target = await interaction.client.users.fetch(userDiscordId).catch(() => null);
  if (!target) {
    return interaction.update({ content: 'User not found.', embeds: [], components: [] });
  }

  const { HANDLERS } = await import('../commands/members.js');
  return HANDLERS.view(interaction, ctx, { user: target });
}
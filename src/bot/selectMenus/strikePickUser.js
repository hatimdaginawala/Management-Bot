// src/bot/selectMenus/strikePickUser.js
export const customId = ['strike:pick-user:view', 'strike:pick-user:history'];
export const meta = {};

export async function execute(interaction, ctx) {
  const kind = interaction.customId.split(':')[2]; // 'view' | 'history'
  const userDiscordId = interaction.values[0];

  const { HANDLERS } = await import('../commands/strike.js');
  const target = await interaction.client.users.fetch(userDiscordId).catch(() => null);
  if (!target) {
    return interaction.update({ content: 'User not found.', embeds: [], components: [] });
  }

  const fn = kind === 'view' ? HANDLERS.view : HANDLERS.history;
  return fn(interaction, ctx, { user: target });
}
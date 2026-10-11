import { infoEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { renderCategoryPicker } from '../modals/roleCreate.js';

export const customId = 'role-flow:permissions:*';
export const meta = {};

export async function execute(interaction) {
  const discordId = interaction.user.id;
  const parts = interaction.customId.split(':');
  const category = parts[2];

  const flowKind = sessions.getSession('role:create-flow', discordId)
    ? 'role:create-flow'
    : sessions.getSession('role:edit-flow', discordId)
      ? 'role:edit-flow'
      : null;

  if (!flowKind) {
    return interaction.update({
      embeds: [infoEmbed({ title: 'Session Expired', description: 'Please run the command again.' })],
      components: [],
    });
  }

  // The default values from the picker's `default: true` are what the user chose.
  // The interaction.values array contains ONLY newly-selected values — NOT the
  // pre-checked ones. So we need to merge.
  //
  // Actually Discord sends the FULL list of selections from the picker, including
  // pre-selected ones that the user kept. So `interaction.values` is the
  // authoritative list for THIS category.
  //
  // We replace all values from this category in the session with the new list.
  const session = sessions.getSession(flowKind, discordId);
  const newCategorySelection = interaction.values;
  const otherCategoryPerms = session.permissions.filter((p) => {
    // A permission is "from another category" if it's not in this category.
    // We determine this by checking the prefix before the first dot.
    return !p.startsWith(category + '.') && !p.startsWith(category + '.*');
  });
  session.permissions = [...otherCategoryPerms, ...newCategorySelection];
  sessions.updateSession(flowKind, discordId, { permissions: session.permissions });

  return renderCategoryPicker(interaction, discordId, { flowKind });
}
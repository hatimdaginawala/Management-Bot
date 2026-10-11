import { MessageFlags } from 'discord.js';
import * as roleService from '../../services/role.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed, infoEmbed } from '../embedBuilders.js';

export const customId = ['role:delete-confirm:*', 'role:delete-cancel'];
export const meta = {};

export async function execute(interaction) {
  const actor = await User.findOne({ discordId: interaction.user.id });
  if (!actor) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(actor._id, 'roles.delete');
  if (!ok) throw new AuthorizationError('You do not have permission to delete roles.');

  if (interaction.customId === 'role:delete-cancel') {
    return interaction.update({
      embeds: [infoEmbed({ title: 'Cancelled', description: 'Role deletion was cancelled.' })],
      components: [],
    });
  }

  const roleKey = interaction.customId.split(':')[2];
  await interaction.deferUpdate();

  try {
    const removed = await roleService.deleteRole(interaction.user.id, roleKey);
    return interaction.editReply({
      embeds: [successEmbed({
        title: 'Role Deleted',
        description: 'Role **' + removed.name + '** (`' + removed.key + '`) has been deleted.',
      })],
      components: [],
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [errorEmbed({
        title: 'Delete Failed',
        description: err.isOperational ? err.message : 'An unexpected error occurred.',
      })],
      components: [],
    });
  }
}
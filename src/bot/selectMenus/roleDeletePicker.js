import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import * as roleService from '../../services/role.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { infoEmbed, warningEmbed } from '../embedBuilders.js';
import { AuthorizationError } from '../../utils/errors.js';

export const customId = 'role:delete:role';
export const meta = {};

export async function execute(interaction) {
  const actor = await userRepo.findByDiscordId(interaction.user.id);
  if (!actor) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(actor.id, 'roles.delete');
  if (!ok) throw new AuthorizationError('You do not have permission to delete roles.');

  const roleKey = interaction.values[0];

  const role = await roleService.getRoleByKey(roleKey).catch(() => null);
  if (!role) {
    return interaction.update({
      embeds: [warningEmbed({ title: 'Role Not Found', description: 'The selected role no longer exists.' })],
      components: [],
    });
  }

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('role:delete-confirm:' + role.key)
      .setLabel('Delete "' + role.name + '"')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('role:delete-cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.update({
    embeds: [warningEmbed({
      title: 'Confirm Role Deletion',
      description:
        'You are about to permanently delete the role **' + role.name + '** (`' + role.key + '`).\n\n' +
        'This cannot be undone. Any active assignments must be removed first.',
      fields: [
        { name: 'Priority', value: String(role.priority), inline: true },
        { name: 'Permissions', value: String(role.permissions.length), inline: true },
      ],
    })],
    components: [confirmRow],
  });
}
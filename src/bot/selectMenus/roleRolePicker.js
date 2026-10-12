import * as roleService from '../../services/role.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { successEmbed, errorEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';

export const customId = ['role:assign:role', 'role:remove:role'];
export const meta = {};

export async function execute(interaction) {
  const kind = interaction.customId.split(':')[1];
  const roleKey = interaction.values[0];

  const actor = await userRepo.findByDiscordId(interaction.user.id);
  if (!actor) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(actor.id, 'roles.assign');
  if (!ok) throw new AuthorizationError('You do not have permission to assign roles.');

  const session = sessions.getSession('role:' + kind, interaction.user.id);
  if (!session || !session.userId) {
    return interaction.update({
      embeds: [errorEmbed({ title: 'Session Expired', description: 'Please run `/roles ' + kind + '` again.' })],
      components: [],
    });
  }

  if (kind === 'assign') {
    const result = await roleService.assignRole(
      interaction.user.id,
      session.userId,
      roleKey,
      { reason: 'Assigned via /roles assign' }
    );

    sessions.clearSession('role:assign', interaction.user.id);

    return interaction.update({
      embeds: [successEmbed({
        title: result.assigned ? 'Role Assigned' : 'Already Assigned',
        description: '<@' + session.userId + '> now has role `' + roleKey + '`.',
      })],
      components: [],
    });
  }

  const result = await roleService.removeRole(
    interaction.user.id,
    session.userId,
    roleKey,
    { reason: 'Removed via /roles remove' }
  );

  sessions.clearSession('role:remove', interaction.user.id);

  return interaction.update({
    embeds: [successEmbed({
      title: result.removed ? 'Role Removed' : 'Not Assigned',
      description: '<@' + session.userId + '> no longer has role `' + roleKey + '`.',
    })],
    components: [],
  });
}
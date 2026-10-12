import { MessageFlags } from 'discord.js';
import * as roleService from '../../services/role.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import * as sessions from '../sessions.js';
import { renderCategoryPicker } from './roleCreate.js';

export const customId = 'modal:role-edit:*';
export const meta = {};

export async function execute(interaction) {
  const key = interaction.customId.split(':')[2];
  if (!key) throw new ValidationError('Missing role key in interaction.');

  const actor = await userRepo.findByDiscordId(interaction.user.id);
  if (!actor) throw new AuthorizationError('You do not have permission.');
  const ok = await permissionService.hasPermission(actor.id, 'roles.edit');
  if (!ok) throw new AuthorizationError('You do not have permission to edit roles.');

  const existingRole = await roleService.getRoleByKey(key);

  const patch = {};
  const name = interaction.fields.getTextInputValue('name').trim();
  if (name) patch.name = name;
  const description = interaction.fields.getTextInputValue('description').trim();
  if (description) patch.description = description;
  const priorityRaw = interaction.fields.getTextInputValue('priority').trim();
  if (priorityRaw) {
    const priority = Number.parseInt(priorityRaw, 10);
    if (!Number.isInteger(priority) || priority < 0 || priority > 999) {
      throw new ValidationError('Priority must be an integer between 0 and 999.');
    }
    patch.priority = priority;
  }
  const quotaRaw = interaction.fields.getTextInputValue('quotaCategory').trim().toUpperCase();
  if (quotaRaw) {
    if (!['NONE', 'STAFF', 'LOW_RANK'].includes(quotaRaw)) {
      throw new ValidationError('Quota category must be NONE, STAFF, or LOW_RANK.');
    }
    patch.quotaCategory = quotaRaw;
  }

  sessions.startSession('role:edit-flow', interaction.user.id, {
    key: existingRole.key,
    name: patch.name || existingRole.name,
    description: patch.description || existingRole.description,
    priority: patch.priority ?? existingRole.priority,
    quotaCategory: patch.quotaCategory || existingRole.quota_category,
    permissions: (existingRole.permissions || []).slice(),
    isEdit: true,
  });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await renderCategoryPicker(interaction, interaction.user.id, { flowKind: 'role:edit-flow' });
}
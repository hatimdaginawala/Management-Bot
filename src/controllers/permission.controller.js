import * as permissionRepo from '../db/repositories/permission.repository.js';
import * as permissionService from '../services/permission.service.js';

export async function listPermissions(req, res) {
  const items = await permissionRepo.list();
  res.json({ success: true, data: items });
}

export async function getEffectivePermissions(req, res) {
  const perms = await permissionService.getEffectivePermissionsByDiscordId(
    req.params.discordId
  );
  res.json({ success: true, data: Array.from(perms).sort() });
}
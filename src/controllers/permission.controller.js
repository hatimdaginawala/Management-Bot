import { Permission } from '../models/index.js';
import * as permissionService from '../services/permission.service.js';

export async function listPermissions(req, res) {
  const items = await Permission.find({}).sort({ category: 1, key: 1 }).lean();
  res.json({ success: true, data: items });
}

export async function getEffectivePermissions(req, res) {
  const perms = await permissionService.getEffectivePermissionsByDiscordId(
    req.params.discordId
  );
  res.json({ success: true, data: Array.from(perms).sort() });
}

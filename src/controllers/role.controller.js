import * as roleService from '../services/role.service.js';

export async function listRoles(req, res) {
  const items = await roleService.listRoles({
    includeInactive: req.query.includeInactive === 'true',
  });
  res.json({ success: true, data: items });
}

export async function getRole(req, res) {
  const role = await roleService.getRoleByKey(req.params.key);
  res.json({ success: true, data: role });
}

export async function createRole(req, res) {
  const role = await roleService.createRole(req.body.actorId, {
    key: req.body.key,
    name: req.body.name,
    description: req.body.description,
    permissions: req.body.permissions,
    priority: req.body.priority,
    quotaCategory: req.body.quotaCategory,
  });
  res.status(201).json({ success: true, data: role.toObject() });
}

export async function editRole(req, res) {
  const patch = req.body.patch ?? req.body;
  const role = await roleService.editRole(req.body.actorId, req.params.key, patch);
  res.json({ success: true, data: role.toObject() });
}

export async function deleteRole(req, res) {
  const removed = await roleService.deleteRole(req.body.actorId, req.params.key);
  res.json({ success: true, data: removed });
}

export async function assignRole(req, res) {
  const result = await roleService.assignRole(
    req.body.actorId,
    req.body.discordId,
    req.params.key,
    { reason: req.body.reason }
  );
  res.json({ success: true, data: result });
}

export async function removeRole(req, res) {
  const result = await roleService.removeRole(
    req.body.actorId,
    req.body.discordId,
    req.params.key,
    { reason: req.body.reason }
  );
  res.json({ success: true, data: result });
}

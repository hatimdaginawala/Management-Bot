import * as settingsService from '../services/settings.service.js';

export async function getSettings(req, res) {
  const doc = await settingsService.getSettings();
  res.json({ success: true, data: doc });
}

export async function listPaths(req, res) {
  const { rows } = await settingsService.describeSettings();
  res.json({ success: true, data: rows });
}

export async function patchSettings(req, res) {
  const actorId = req.body.actorId 
  const patch = req.body.patch 
  const result = await settingsService.setSettings(actorId, patch, {
    reason: req.body.reason 
  });
  res.json({ success: true, data: result });
}

export async function resetSetting(req, res) {
  const actorId = req.body.actorId 
  const value = await settingsService.resetSetting(actorId, req.body.path, {
    reason: req.body.reason 
  });
  res.json({ success: true, data: { path: req.body.path, value } });
}

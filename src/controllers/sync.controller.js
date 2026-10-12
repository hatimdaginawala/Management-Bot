import { runJobSync } from '../jobs/runner.js';
import * as syncLogRepo from '../db/repositories/syncLog.repository.js';

export async function trigger(req, res) {
  const result = await runJobSync('roblox-sync', {
    triggeredBy: req.body.triggeredBy || 'api',
  });
  res.json({ success: true, data: result });
}

export async function status(req, res) {
  const latest = await syncLogRepo.findLatest('ROBLOX_GROUP_SYNC');
  res.json({ success: true, data: latest || null });
}
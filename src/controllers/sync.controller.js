import { runJobSync } from '../jobs/runner.js';
import { SyncLog } from '../models/index.js';

export async function trigger(req, res) {
  const result = await runJobSync('roblox-sync', {
    triggeredBy: req.body.triggeredBy || 'api',
  });
  res.json({ success: true, data: result });
}

export async function status(req, res) {
  const latest = await SyncLog.findOne({ type: 'ROBLOX_GROUP_SYNC' })
    .sort({ startedAt: -1 })
    .lean();
  res.json({ success: true, data: latest || null });
}
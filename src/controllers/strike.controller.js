import * as strikeService from '../services/strike.service.js';

export async function getActive(req, res) {
  const items = await strikeService.getActiveStrikes(req.params.discordId);
  res.json({ success: true, data: items });
}

export async function getHistory(req, res) {
  const items = await strikeService.getStrikeHistory(req.params.discordId, {
    limit: req.query.limit,
  });
  res.json({ success: true, data: items });
}

export async function issueManual(req, res) {
  const strike = await strikeService.issueManualStrike(req.body.actorId, {
    targetDiscordId: req.body.targetDiscordId,
    reason: req.body.reason,
  });
  res.status(201).json({ success: true, data: strike.toObject() });
}

export async function removeStrike(req, res) {
  const result = await strikeService.removeStrike(req.body.actorId, req.params.id, {
    reason: req.body.reason,
  });
  res.json({ success: true, data: result });
}

export async function recoverStrike(req, res) {
  const result = await strikeService.recoverStrike(req.body.actorId, req.params.id, {
    reason: req.body.reason,
    periodKey: req.body.periodKey,
  });
  res.json({ success: true, data: result });
}

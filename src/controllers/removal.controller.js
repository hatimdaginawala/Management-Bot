import * as removalRequestService from '../services/removalRequest.service.js';

export async function listPending(req, res) {
  const result = await removalRequestService.listPendingRemovals({
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, data: result });
}

export async function createManual(req, res) {
  const request = await removalRequestService.createManual(req.body.actorId, {
    targetDiscordId: req.body.targetDiscordId,
    description: req.body.description,
  });
  res.status(201).json({ success: true, data: request });
}

export async function approve(req, res) {
  const request = await removalRequestService.approveRemoval(req.body.actorId, req.params.id, {
    reason: req.body.reason,
    effectiveAt: req.body.effectiveAt ? new Date(req.body.effectiveAt) : null,
  });
  res.json({ success: true, data: request });
}

export async function dismiss(req, res) {
  const request = await removalRequestService.dismissRemoval(req.body.actorId, req.params.id, {
    reason: req.body.reason,
  });
  res.json({ success: true, data: request });
}

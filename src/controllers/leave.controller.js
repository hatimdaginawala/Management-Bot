import * as leaveService from '../services/leave.service.js';

export async function list(req, res) {
  const result = await leaveService.listLeaves({
    status: req.query.status,
    discordId: req.query.discordId,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, data: result });
}

export async function create(req, res) {
  const leave = await leaveService.createLeaveRequest(req.body.discordId, {
    startAt: req.body.startAt ? new Date(req.body.startAt) : null,
    endAt: req.body.endAt ? new Date(req.body.endAt) : null,
    reason: req.body.reason,
    notes: req.body.notes,
  });
  res.status(201).json({ success: true, data: leave });
}

export async function approve(req, res) {
  const result = await leaveService.approveLeave(req.body.actorId, req.params.id, {
    reason: req.body.reason,
  });
  res.json({ success: true, data: result });
}

export async function reject(req, res) {
  const leave = await leaveService.rejectLeave(req.body.actorId, req.params.id, {
    reason: req.body.reason,
  });
  res.json({ success: true, data: leave });
}

export async function end(req, res) {
  const result = await leaveService.endLeave(req.body.actorId, req.params.id, {
    reason: req.body.reason,
  });
  res.json({ success: true, data: result });
}

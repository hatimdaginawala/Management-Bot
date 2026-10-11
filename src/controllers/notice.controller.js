import * as noticeService from '../services/notice.service.js';

export async function list(req, res) {
  const result = await noticeService.listNotices({
    status: req.query.status,
    discordId: req.query.discordId,
    type: req.query.type,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, data: result });
}

export async function create(req, res) {
  const notice = await noticeService.createNotice(req.body.actorId, {
    targetDiscordId: req.body.targetDiscordId,
    type: req.body.type,
    reason: req.body.reason,
    startAt: req.body.startAt ? new Date(req.body.startAt) : null,
    endAt: req.body.endAt ? new Date(req.body.endAt) : null,
    grantsQuotaExemption: req.body.grantsQuotaExemption,
    notes: req.body.notes,
  });
  res.status(201).json({ success: true, data: notice });
}

export async function cancel(req, res) {
  const result = await noticeService.cancelNotice(req.body.actorId, req.params.id, {
    reason: req.body.reason,
  });
  res.json({ success: true, data: result });
}

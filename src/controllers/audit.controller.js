import * as auditService from '../services/audit.service.js';

export async function query(req, res) {
  const result = await auditService.queryLogs({
    actorId: req.query.actorId,
    action: req.query.action,
    category: req.query.category,
    targetType: req.query.targetType,
    targetId: req.query.targetId,
    from: req.query.from ? new Date(req.query.from) : undefined,
    to: req.query.to ? new Date(req.query.to) : undefined,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, data: result });
}

export async function get(req, res) {
  const entry = await auditService.getEntry(req.params.id);
  res.json({ success: true, data: entry });
}

export async function summary(req, res) {
  const result = await auditService.summarize({
    from: req.query.from ? new Date(req.query.from) : undefined,
    to: req.query.to ? new Date(req.query.to) : undefined,
  });
  res.json({ success: true, data: result });
}

export async function categories(req, res) {
  const result = await auditService.listCategories();
  res.json({ success: true, data: result });
}

export async function actions(req, res) {
  const result = await auditService.listActions({ category: req.query.category });
  res.json({ success: true, data: result });
}

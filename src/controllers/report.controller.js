import * as reportService from '../services/report.service.js';

export async function list(req, res) {
  const result = await reportService.listReports({
    kind: req.query.kind,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, data: result });
}

export async function get(req, res) {
  const report = await reportService.getReportById(req.params.id);
  res.json({ success: true, data: report });
}

export async function generateWeekly(req, res) {
  const report = await reportService.generateWeeklyReport({
    asOf: req.body.asOf ? new Date(req.body.asOf) : new Date(),
    generatedBy: req.body.actorId || 'api',
  });
  res.status(201).json({ success: true, data: report });
}

export async function generateMonthly(req, res) {
  const report = await reportService.generateMonthlyReport({
    asOf: req.body.asOf ? new Date(req.body.asOf) : new Date(),
    generatedBy: req.body.actorId || 'api',
  });
  res.status(201).json({ success: true, data: report });
}

export async function generateManual(req, res) {
  const report = await reportService.generateManualReport({
    from: req.body.from ? new Date(req.body.from) : null,
    to: req.body.to ? new Date(req.body.to) : null,
    generatedBy: req.body.actorId || 'api',
    label: req.body.label,
  });
  res.status(201).json({ success: true, data: report });
}
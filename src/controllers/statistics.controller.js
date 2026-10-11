import * as statisticsService from '../services/statistics.service.js';

export async function daily(req, res) {
  const result = await statisticsService.dailyStats({
    asOf: req.query.asOf ? new Date(req.query.asOf) : undefined,
    top: req.query.top,
  });
  res.json({ success: true, data: result });
}

export async function weekly(req, res) {
  const result = await statisticsService.weeklyStats({
    asOf: req.query.asOf ? new Date(req.query.asOf) : undefined,
    top: req.query.top,
  });
  res.json({ success: true, data: result });
}

export async function monthly(req, res) {
  const result = await statisticsService.monthlyStats({
    asOf: req.query.asOf ? new Date(req.query.asOf) : undefined,
    top: req.query.top,
  });
  res.json({ success: true, data: result });
}

export async function user(req, res) {
  const result = await statisticsService.userStats(req.params.discordId);
  res.json({ success: true, data: result });
}

export async function members(req, res) {
  const result = await statisticsService.memberBreakdown();
  res.json({ success: true, data: result });
}

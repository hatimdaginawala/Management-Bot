import * as attendanceService from '../services/attendance.service.js';

export async function listAttendance(req, res) {
  const result = await attendanceService.listAttendance({
    userDiscordId: req.query.userDiscordId,
    eventId: req.query.eventId,
    eventTypeKey: req.query.eventTypeKey,
    from: req.query.from ? new Date(req.query.from) : undefined,
    to: req.query.to ? new Date(req.query.to) : undefined,
    includeInactive: req.query.includeInactive === 'true',
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, data: result });
}

export async function getHistory(req, res) {
  const result = await attendanceService.getAttendanceHistory(
    req.params.discordId,
    { limit: req.query.limit }
  );
  res.json({ success: true, data: result });
}

export async function getStats(req, res) {
  const result = await attendanceService.attendanceStats({
    mode: req.query.mode,
    from: req.query.from ? new Date(req.query.from) : undefined,
    to: req.query.to ? new Date(req.query.to) : undefined,
    limit: req.query.limit,
  });
  res.json({ success: true, data: result });
}

export async function addManual(req, res) {
  const record = await attendanceService.addManualAttendance(req.body.actorId, {
    eventId: req.body.eventId,
    userDiscordId: req.body.userDiscordId,
    reason: req.body.reason,
  });
  res.status(201).json({ success: true, data: record });
}

export async function removeManual(req, res) {
  const record = await attendanceService.removeManualAttendance(req.body.actorId, {
    eventId: req.body.eventId,
    userDiscordId: req.body.userDiscordId,
    reason: req.body.reason,
  });
  res.json({ success: true, data: record });
}

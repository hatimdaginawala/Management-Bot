import * as eventService from '../services/event.service.js';

export async function listEvents(req, res) {
  const result = await eventService.listEvents({
    status: req.query.status,
    hostDiscordId: req.query.hostDiscordId,
    eventTypeKey: req.query.eventTypeKey,
    from: req.query.from ? new Date(req.query.from) : undefined,
    to: req.query.to ? new Date(req.query.to) : undefined,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json({ success: true, data: result });
}

export async function getEvent(req, res) {
  const event = await eventService.getEvent(req.params.id);
  res.json({ success: true, data: event });
}

export async function createEvent(req, res) {
  const event = await eventService.createEvent(req.body.hostDiscordId, {
    eventTypeKey: req.body.eventTypeKey,
    attendees: req.body.attendees,
    proofUrl: req.body.proofUrl,
    notes: req.body.notes,
  });
  res.status(201).json({ success: true, data: event.toObject() });
}

export async function approveEvent(req, res) {
  const result = await eventService.approveEvent(req.body.actorId, req.params.id);
  res.json({ success: true, data: result });
}

export async function rejectEvent(req, res) {
  const event = await eventService.rejectEvent(req.body.actorId, req.params.id, {
    reason: req.body.reason,
  });
  res.json({ success: true, data: event });
}

export async function cancelEvent(req, res) {
  const event = await eventService.cancelEvent(req.body.actorId, req.params.id, {
    reason: req.body.reason,
  });
  res.json({ success: true, data: event });
}

export async function updateEvent(req, res) {
  const event = await eventService.updateEvent(req.body.actorId, req.params.id, {
    proofUrl: req.body.proofUrl,
    notes: req.body.notes,
    attendees: req.body.attendees,
  });
  res.json({ success: true, data: event });
}

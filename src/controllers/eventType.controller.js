import * as eventTypeService from '../services/eventType.service.js';

export async function listEventTypes(req, res) {
  const items = await eventTypeService.listEventTypes({
    includeInactive: req.query.includeInactive === 'true',
  });
  res.json({ success: true, data: items });
}

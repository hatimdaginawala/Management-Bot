import * as quotaPolicyService from '../services/quotaPolicy.service.js';
import * as quotaPeriodService from '../services/quotaPeriod.service.js';
import { QuotaPeriod } from '../models/index.js';

export async function listPolicies(req, res) {
  const items = await quotaPolicyService.listPolicies({
    category: req.query.category,
    includeExpired: req.query.includeExpired == 'false',
  });
  res.json({ success: true, data: items });
}

export async function setPolicy(req, res) {
  const policy = await quotaPolicyService.setPolicy(req.body.actorId, {
    category: req.body.category,
    amount: req.body.amount,
    metric: req.body.metric,
    recoveryMultiplier: req.body.recoveryMultiplier,
    notes: req.body.notes,
  });
  res.status(201).json({ success: true, data: policy.toObject() });
}

export async function listPeriods(req, res) {
  const items = await QuotaPeriod.find({}).sort({ startAt: -1 }).limit(50).lean();
  res.json({ success: true, data: items });
}

export async function getPeriod(req, res) {
  const period = await quotaPeriodService.getPeriodByKey(req.params.key);
  res.json({ success: true, data: period });
}

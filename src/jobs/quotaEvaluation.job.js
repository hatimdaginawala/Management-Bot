import { evaluatePeriod } from '../services/quotaEvaluation.service.js';
import { getCurrentPeriod } from '../services/quotaPeriod.service.js';
import { isoWeekKey, previousKey } from '../utils/isoWeek.js';
import { dmStrikeIssued } from '../bot/utils/userDm.js';
import logger from '../config/logger.js';

export const name = 'quota-evaluation';

export async function run({ actorId = 'system', client = null } = {}) {
  const now = new Date();
  const thisWeekKey = isoWeekKey(now);
  const lastWeekKey = previousKey(thisWeekKey);

  const current = await getCurrentPeriod();
  if (!current) {
    logger.info({ job: name }, 'No open period — skipping (fresh install)');
    return { skipped: true, reason: 'no-open-period' };
  }
  if (current.periodKey === lastWeekKey) {
    logger.info({ job: name, currentPeriod: current.periodKey, target: lastWeekKey }, 'Previous period not yet closed — skipping');
    return { skipped: true, reason: 'previous-not-closed' };
  }

  
  const onStrikeIssued = client
    ? async ({ user, strike }) => {
        await dmStrikeIssued(client, {
          discordId: user.discordId,
          _id: strike._id,
          type: strike.type,
          reason: strike.reason,
          quotaPeriodKey: strike.quotaPeriodKey,
          issuedAt: strike.issuedAt,
        }, { actorId: 'system' });
      }
    : null;

  const result = await evaluatePeriod(lastWeekKey, { actorId, onStrikeIssued });
  return result;
}
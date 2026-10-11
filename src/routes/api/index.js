import { Router } from 'express';
import { apiKey } from '../../middleware/apiKey.js';
import users from './users.routes.js';
import roles from './roles.routes.js';
import permissions from './permissions.routes.js';
import events from './events.routes.js';
import eventTypes from './eventTypes.routes.js';
import attendance from './attendance.routes.js';
import quota from './quota.routes.js';
import strikes from './strikes.routes.js';
import removals from './removals.routes.js';
import leaves from './leaves.routes.js';
import notices from './notices.routes.js';
import statistics from './statistics.routes.js';
import reports from './reports.routes.js';
import settings from './settings.routes.js';
import audit from './audit.routes.js';
import sync from './sync.routes.js';

const router = Router();

router.use(apiKey);

router.use('/users', users);
router.use('/roles', roles);
router.use('/permissions', permissions);
router.use('/events', events);
router.use('/event-types', eventTypes);
router.use('/attendance', attendance);
router.use('/quota', quota);
router.use('/strikes', strikes);
router.use('/removals', removals);
router.use('/leaves', leaves);
router.use('/notices', notices);
router.use('/statistics', statistics);
router.use('/reports', reports);
router.use('/settings', settings);
router.use('/audit', audit);
router.use('/sync', sync);

export default router;

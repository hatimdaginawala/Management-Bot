import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/quota.controller.js';

const router = Router();

router.get('/policies', asyncHandler(ctrl.listPolicies));
router.post('/policies', asyncHandler(ctrl.setPolicy));
router.get('/periods', asyncHandler(ctrl.listPeriods));
router.get('/periods/:key', asyncHandler(ctrl.getPeriod));

export default router;

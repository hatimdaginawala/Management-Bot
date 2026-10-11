import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/report.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.list));
router.post('/weekly', asyncHandler(ctrl.generateWeekly));
router.post('/monthly', asyncHandler(ctrl.generateMonthly));
router.post('/manual', asyncHandler(ctrl.generateManual));
router.get('/:id', asyncHandler(ctrl.get));

export default router;

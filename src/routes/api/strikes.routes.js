import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/strike.controller.js';

const router = Router();

router.get('/:discordId', asyncHandler(ctrl.getActive));
router.get('/:discordId/history', asyncHandler(ctrl.getHistory));
router.post('/issue', asyncHandler(ctrl.issueManual));
router.post('/:id/remove', asyncHandler(ctrl.removeStrike));
router.post('/:id/recover', asyncHandler(ctrl.recoverStrike));

export default router;

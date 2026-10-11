import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/notice.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.list));
router.post('/', asyncHandler(ctrl.create));
router.post('/:id/cancel', asyncHandler(ctrl.cancel));

export default router;

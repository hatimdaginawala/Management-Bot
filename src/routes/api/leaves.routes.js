import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/leave.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.list));
router.post('/', asyncHandler(ctrl.create));
router.post('/:id/approve', asyncHandler(ctrl.approve));
router.post('/:id/reject', asyncHandler(ctrl.reject));
router.post('/:id/end', asyncHandler(ctrl.end));

export default router;

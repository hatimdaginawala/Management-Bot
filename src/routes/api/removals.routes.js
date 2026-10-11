import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/removal.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.listPending));
router.post('/', asyncHandler(ctrl.createManual));
router.post('/:id/approve', asyncHandler(ctrl.approve));
router.post('/:id/dismiss', asyncHandler(ctrl.dismiss));

export default router;

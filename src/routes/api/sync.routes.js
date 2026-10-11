import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/sync.controller.js';

const router = Router();

router.post('/roblox', asyncHandler(ctrl.trigger));
router.get('/status', asyncHandler(ctrl.status));

export default router;

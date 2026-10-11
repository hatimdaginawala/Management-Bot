import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/eventType.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.listEventTypes));

export default router;

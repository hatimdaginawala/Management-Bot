import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/statistics.controller.js';

const router = Router();

router.get('/daily', asyncHandler(ctrl.daily));
router.get('/weekly', asyncHandler(ctrl.weekly));
router.get('/monthly', asyncHandler(ctrl.monthly));
router.get('/user/:discordId', asyncHandler(ctrl.user));
router.get('/members', asyncHandler(ctrl.members));

export default router;

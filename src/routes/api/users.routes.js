import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/user.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.listUsers));
router.get('/:discordId', asyncHandler(ctrl.getUser));
router.get('/:discordId/profile', asyncHandler(ctrl.getUser));
router.get('/:discordId/history', asyncHandler(ctrl.getUserHistory));

export default router;

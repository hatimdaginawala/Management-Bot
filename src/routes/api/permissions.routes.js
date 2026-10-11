import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/permission.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.listPermissions));
router.get('/effective/:discordId', asyncHandler(ctrl.getEffectivePermissions));

export default router;

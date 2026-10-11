import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/settings.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.getSettings));
router.get('/paths', asyncHandler(ctrl.listPaths));
router.patch('/', asyncHandler(ctrl.patchSettings));
router.post('/reset', asyncHandler(ctrl.resetSetting));

export default router;

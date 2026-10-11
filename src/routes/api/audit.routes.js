import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/audit.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.query));
router.get('/summary', asyncHandler(ctrl.summary));
router.get('/categories', asyncHandler(ctrl.categories));
router.get('/actions', asyncHandler(ctrl.actions));
router.get('/:id', asyncHandler(ctrl.get));

export default router;

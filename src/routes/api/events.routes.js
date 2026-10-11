import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/event.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.listEvents));
router.get('/:id', asyncHandler(ctrl.getEvent));
router.post('/', asyncHandler(ctrl.createEvent));
router.patch('/:id', asyncHandler(ctrl.updateEvent));
router.post('/:id/approve', asyncHandler(ctrl.approveEvent));
router.post('/:id/reject', asyncHandler(ctrl.rejectEvent));
router.post('/:id/cancel', asyncHandler(ctrl.cancelEvent));

export default router;

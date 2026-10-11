import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/attendance.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.listAttendance));
router.get('/history/:discordId', asyncHandler(ctrl.getHistory));
router.get('/stats', asyncHandler(ctrl.getStats));
router.post('/add', asyncHandler(ctrl.addManual));
router.post('/remove', asyncHandler(ctrl.removeManual));

export default router;

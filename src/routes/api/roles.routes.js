import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as ctrl from '../../controllers/role.controller.js';

const router = Router();

router.get('/', asyncHandler(ctrl.listRoles));
router.get('/:key', asyncHandler(ctrl.getRole));
router.post('/', asyncHandler(ctrl.createRole));
router.patch('/:key', asyncHandler(ctrl.editRole));
router.delete('/:key', asyncHandler(ctrl.deleteRole));
router.post('/:key/assign', asyncHandler(ctrl.assignRole));
router.post('/:key/unassign', asyncHandler(ctrl.removeRole));

export default router;

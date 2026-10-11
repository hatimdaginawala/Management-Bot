import { Router } from 'express';
import healthRoutes from './health.routes.js';
import apiRoutes from './api/index.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/api', apiRoutes);

export default router;

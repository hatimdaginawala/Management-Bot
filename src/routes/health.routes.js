import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isDatabaseHealthy } from '../config/database.js';
import { APP_NAME, APP_VERSION } from '../config/constants.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const dbOk = isDatabaseHealthy();
    const status = dbOk ? 'ok' : 'degraded';

    res.status(dbOk ? 200 : 503).json( {
      success: dbOk,
      status,
      app: { name: APP_NAME, version: APP_VERSION },
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      database: { connected: dbOk },
    });
  })
);

export default router;

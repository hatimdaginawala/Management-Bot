@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM  Routes Scaffold - 24th Guard Rifles Management Bot
REM ============================================================

cd /d "%~dp0"
echo Working dir: %CD%
echo.

REM ---------- Create folders ----------
if not exist "src"             mkdir "src"
if not exist "src\routes"      mkdir "src\routes"
if not exist "src\routes\api"  mkdir "src\routes\api"
if not exist "src\middleware"  mkdir "src\middleware"
if not exist "src\config"      mkdir "src\config"

echo Folders ensured.
echo.

REM ============================================================
REM  src\middleware\apiKey.js
REM ============================================================
echo [1/20] apiKey.js
> "src\middleware\apiKey.js" echo import crypto from 'node:crypto';
>>"src\middleware\apiKey.js" echo import config from '../config/index.js';
>>"src\middleware\apiKey.js" echo import {
>>"src\middleware\apiKey.js" echo   AuthenticationError,
>>"src\middleware\apiKey.js" echo   AppError,
>>"src\middleware\apiKey.js" echo } from '../utils/errors.js';
>>"src\middleware\apiKey.js" echo.
>>"src\middleware\apiKey.js" echo export function apiKey(req, _res, next) {
>>"src\middleware\apiKey.js" echo   const expected = config.api.key;
>>"src\middleware\apiKey.js" echo   if (!expected) {
>>"src\middleware\apiKey.js" echo     return next(
>>"src\middleware\apiKey.js" echo       new AppError(
>>"src\middleware\apiKey.js" echo         'API authentication is not configured on this server.',
>>"src\middleware\apiKey.js" echo         { code: 'API_AUTH_NOT_CONFIGURED', statusCode: 503 }
>>"src\middleware\apiKey.js" echo       )
>>"src\middleware\apiKey.js" echo     );
>>"src\middleware\apiKey.js" echo   }
>>"src\middleware\apiKey.js" echo   const provided = req.header('x-api-key');
>>"src\middleware\apiKey.js" echo   if (!provided || typeof provided !== 'string') {
>>"src\middleware\apiKey.js" echo     return next(new AuthenticationError('Missing X-API-Key header.'));
>>"src\middleware\apiKey.js" echo   }
>>"src\middleware\apiKey.js" echo   if (!constantTimeEqual(provided, expected)) {
>>"src\middleware\apiKey.js" echo     return next(new AuthenticationError('Invalid API key.'));
>>"src\middleware\apiKey.js" echo   }
>>"src\middleware\apiKey.js" echo   return next();
>>"src\middleware\apiKey.js" echo }
>>"src\middleware\apiKey.js" echo.
>>"src\middleware\apiKey.js" echo function constantTimeEqual(a, b) {
>>"src\middleware\apiKey.js" echo   const aBuf = Buffer.from(String(a), 'utf8');
>>"src\middleware\apiKey.js" echo   const bBuf = Buffer.from(String(b), 'utf8');
>>"src\middleware\apiKey.js" echo   if (aBuf.length !== bBuf.length) return false;
>>"src\middleware\apiKey.js" echo   return crypto.timingSafeEqual(aBuf, bBuf);
>>"src\middleware\apiKey.js" echo }

REM ============================================================
REM  src\routes\api\users.routes.js
REM ============================================================
echo [2/20] users.routes.js
> "src\routes\api\users.routes.js" echo import { Router } from 'express';
>>"src\routes\api\users.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\users.routes.js" echo import * as ctrl from '../../controllers/user.controller.js';
>>"src\routes\api\users.routes.js" echo.
>>"src\routes\api\users.routes.js" echo const router = Router();
>>"src\routes\api\users.routes.js" echo.
>>"src\routes\api\users.routes.js" echo router.get('/', asyncHandler(ctrl.listUsers));
>>"src\routes\api\users.routes.js" echo router.get('/:discordId', asyncHandler(ctrl.getUser));
>>"src\routes\api\users.routes.js" echo router.get('/:discordId/profile', asyncHandler(ctrl.getUser));
>>"src\routes\api\users.routes.js" echo router.get('/:discordId/history', asyncHandler(ctrl.getUserHistory));
>>"src\routes\api\users.routes.js" echo.
>>"src\routes\api\users.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\roles.routes.js
REM ============================================================
echo [3/20] roles.routes.js
> "src\routes\api\roles.routes.js" echo import { Router } from 'express';
>>"src\routes\api\roles.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\roles.routes.js" echo import * as ctrl from '../../controllers/role.controller.js';
>>"src\routes\api\roles.routes.js" echo.
>>"src\routes\api\roles.routes.js" echo const router = Router();
>>"src\routes\api\roles.routes.js" echo.
>>"src\routes\api\roles.routes.js" echo router.get('/', asyncHandler(ctrl.listRoles));
>>"src\routes\api\roles.routes.js" echo router.get('/:key', asyncHandler(ctrl.getRole));
>>"src\routes\api\roles.routes.js" echo router.post('/', asyncHandler(ctrl.createRole));
>>"src\routes\api\roles.routes.js" echo router.patch('/:key', asyncHandler(ctrl.editRole));
>>"src\routes\api\roles.routes.js" echo router.delete('/:key', asyncHandler(ctrl.deleteRole));
>>"src\routes\api\roles.routes.js" echo router.post('/:key/assign', asyncHandler(ctrl.assignRole));
>>"src\routes\api\roles.routes.js" echo router.post('/:key/unassign', asyncHandler(ctrl.removeRole));
>>"src\routes\api\roles.routes.js" echo.
>>"src\routes\api\roles.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\permissions.routes.js
REM ============================================================
echo [4/20] permissions.routes.js
> "src\routes\api\permissions.routes.js" echo import { Router } from 'express';
>>"src\routes\api\permissions.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\permissions.routes.js" echo import * as ctrl from '../../controllers/permission.controller.js';
>>"src\routes\api\permissions.routes.js" echo.
>>"src\routes\api\permissions.routes.js" echo const router = Router();
>>"src\routes\api\permissions.routes.js" echo.
>>"src\routes\api\permissions.routes.js" echo router.get('/', asyncHandler(ctrl.listPermissions));
>>"src\routes\api\permissions.routes.js" echo router.get('/effective/:discordId', asyncHandler(ctrl.getEffectivePermissions));
>>"src\routes\api\permissions.routes.js" echo.
>>"src\routes\api\permissions.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\events.routes.js
REM ============================================================
echo [5/20] events.routes.js
> "src\routes\api\events.routes.js" echo import { Router } from 'express';
>>"src\routes\api\events.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\events.routes.js" echo import * as ctrl from '../../controllers/event.controller.js';
>>"src\routes\api\events.routes.js" echo.
>>"src\routes\api\events.routes.js" echo const router = Router();
>>"src\routes\api\events.routes.js" echo.
>>"src\routes\api\events.routes.js" echo router.get('/', asyncHandler(ctrl.listEvents));
>>"src\routes\api\events.routes.js" echo router.get('/:id', asyncHandler(ctrl.getEvent));
>>"src\routes\api\events.routes.js" echo router.post('/', asyncHandler(ctrl.createEvent));
>>"src\routes\api\events.routes.js" echo router.patch('/:id', asyncHandler(ctrl.updateEvent));
>>"src\routes\api\events.routes.js" echo router.post('/:id/approve', asyncHandler(ctrl.approveEvent));
>>"src\routes\api\events.routes.js" echo router.post('/:id/reject', asyncHandler(ctrl.rejectEvent));
>>"src\routes\api\events.routes.js" echo router.post('/:id/cancel', asyncHandler(ctrl.cancelEvent));
>>"src\routes\api\events.routes.js" echo.
>>"src\routes\api\events.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\eventTypes.routes.js
REM ============================================================
echo [6/20] eventTypes.routes.js
> "src\routes\api\eventTypes.routes.js" echo import { Router } from 'express';
>>"src\routes\api\eventTypes.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\eventTypes.routes.js" echo import * as ctrl from '../../controllers/eventType.controller.js';
>>"src\routes\api\eventTypes.routes.js" echo.
>>"src\routes\api\eventTypes.routes.js" echo const router = Router();
>>"src\routes\api\eventTypes.routes.js" echo.
>>"src\routes\api\eventTypes.routes.js" echo router.get('/', asyncHandler(ctrl.listEventTypes));
>>"src\routes\api\eventTypes.routes.js" echo.
>>"src\routes\api\eventTypes.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\attendance.routes.js
REM ============================================================
echo [7/20] attendance.routes.js
> "src\routes\api\attendance.routes.js" echo import { Router } from 'express';
>>"src\routes\api\attendance.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\attendance.routes.js" echo import * as ctrl from '../../controllers/attendance.controller.js';
>>"src\routes\api\attendance.routes.js" echo.
>>"src\routes\api\attendance.routes.js" echo const router = Router();
>>"src\routes\api\attendance.routes.js" echo.
>>"src\routes\api\attendance.routes.js" echo router.get('/', asyncHandler(ctrl.listAttendance));
>>"src\routes\api\attendance.routes.js" echo router.get('/history/:discordId', asyncHandler(ctrl.getHistory));
>>"src\routes\api\attendance.routes.js" echo router.get('/stats', asyncHandler(ctrl.getStats));
>>"src\routes\api\attendance.routes.js" echo router.post('/add', asyncHandler(ctrl.addManual));
>>"src\routes\api\attendance.routes.js" echo router.post('/remove', asyncHandler(ctrl.removeManual));
>>"src\routes\api\attendance.routes.js" echo.
>>"src\routes\api\attendance.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\quota.routes.js
REM ============================================================
echo [8/20] quota.routes.js
> "src\routes\api\quota.routes.js" echo import { Router } from 'express';
>>"src\routes\api\quota.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\quota.routes.js" echo import * as ctrl from '../../controllers/quota.controller.js';
>>"src\routes\api\quota.routes.js" echo.
>>"src\routes\api\quota.routes.js" echo const router = Router();
>>"src\routes\api\quota.routes.js" echo.
>>"src\routes\api\quota.routes.js" echo router.get('/policies', asyncHandler(ctrl.listPolicies));
>>"src\routes\api\quota.routes.js" echo router.post('/policies', asyncHandler(ctrl.setPolicy));
>>"src\routes\api\quota.routes.js" echo router.get('/periods', asyncHandler(ctrl.listPeriods));
>>"src\routes\api\quota.routes.js" echo router.get('/periods/:key', asyncHandler(ctrl.getPeriod));
>>"src\routes\api\quota.routes.js" echo.
>>"src\routes\api\quota.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\strikes.routes.js
REM ============================================================
echo [9/20] strikes.routes.js
> "src\routes\api\strikes.routes.js" echo import { Router } from 'express';
>>"src\routes\api\strikes.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\strikes.routes.js" echo import * as ctrl from '../../controllers/strike.controller.js';
>>"src\routes\api\strikes.routes.js" echo.
>>"src\routes\api\strikes.routes.js" echo const router = Router();
>>"src\routes\api\strikes.routes.js" echo.
>>"src\routes\api\strikes.routes.js" echo router.get('/:discordId', asyncHandler(ctrl.getActive));
>>"src\routes\api\strikes.routes.js" echo router.get('/:discordId/history', asyncHandler(ctrl.getHistory));
>>"src\routes\api\strikes.routes.js" echo router.post('/issue', asyncHandler(ctrl.issueManual));
>>"src\routes\api\strikes.routes.js" echo router.post('/:id/remove', asyncHandler(ctrl.removeStrike));
>>"src\routes\api\strikes.routes.js" echo router.post('/:id/recover', asyncHandler(ctrl.recoverStrike));
>>"src\routes\api\strikes.routes.js" echo.
>>"src\routes\api\strikes.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\removals.routes.js
REM ============================================================
echo [10/20] removals.routes.js
> "src\routes\api\removals.routes.js" echo import { Router } from 'express';
>>"src\routes\api\removals.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\removals.routes.js" echo import * as ctrl from '../../controllers/removal.controller.js';
>>"src\routes\api\removals.routes.js" echo.
>>"src\routes\api\removals.routes.js" echo const router = Router();
>>"src\routes\api\removals.routes.js" echo.
>>"src\routes\api\removals.routes.js" echo router.get('/', asyncHandler(ctrl.listPending));
>>"src\routes\api\removals.routes.js" echo router.post('/', asyncHandler(ctrl.createManual));
>>"src\routes\api\removals.routes.js" echo router.post('/:id/approve', asyncHandler(ctrl.approve));
>>"src\routes\api\removals.routes.js" echo router.post('/:id/dismiss', asyncHandler(ctrl.dismiss));
>>"src\routes\api\removals.routes.js" echo.
>>"src\routes\api\removals.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\leaves.routes.js
REM ============================================================
echo [11/20] leaves.routes.js
> "src\routes\api\leaves.routes.js" echo import { Router } from 'express';
>>"src\routes\api\leaves.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\leaves.routes.js" echo import * as ctrl from '../../controllers/leave.controller.js';
>>"src\routes\api\leaves.routes.js" echo.
>>"src\routes\api\leaves.routes.js" echo const router = Router();
>>"src\routes\api\leaves.routes.js" echo.
>>"src\routes\api\leaves.routes.js" echo router.get('/', asyncHandler(ctrl.list));
>>"src\routes\api\leaves.routes.js" echo router.post('/', asyncHandler(ctrl.create));
>>"src\routes\api\leaves.routes.js" echo router.post('/:id/approve', asyncHandler(ctrl.approve));
>>"src\routes\api\leaves.routes.js" echo router.post('/:id/reject', asyncHandler(ctrl.reject));
>>"src\routes\api\leaves.routes.js" echo router.post('/:id/end', asyncHandler(ctrl.end));
>>"src\routes\api\leaves.routes.js" echo.
>>"src\routes\api\leaves.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\notices.routes.js
REM ============================================================
echo [12/20] notices.routes.js
> "src\routes\api\notices.routes.js" echo import { Router } from 'express';
>>"src\routes\api\notices.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\notices.routes.js" echo import * as ctrl from '../../controllers/notice.controller.js';
>>"src\routes\api\notices.routes.js" echo.
>>"src\routes\api\notices.routes.js" echo const router = Router();
>>"src\routes\api\notices.routes.js" echo.
>>"src\routes\api\notices.routes.js" echo router.get('/', asyncHandler(ctrl.list));
>>"src\routes\api\notices.routes.js" echo router.post('/', asyncHandler(ctrl.create));
>>"src\routes\api\notices.routes.js" echo router.post('/:id/cancel', asyncHandler(ctrl.cancel));
>>"src\routes\api\notices.routes.js" echo.
>>"src\routes\api\notices.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\statistics.routes.js
REM ============================================================
echo [13/20] statistics.routes.js
> "src\routes\api\statistics.routes.js" echo import { Router } from 'express';
>>"src\routes\api\statistics.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\statistics.routes.js" echo import * as ctrl from '../../controllers/statistics.controller.js';
>>"src\routes\api\statistics.routes.js" echo.
>>"src\routes\api\statistics.routes.js" echo const router = Router();
>>"src\routes\api\statistics.routes.js" echo.
>>"src\routes\api\statistics.routes.js" echo router.get('/daily', asyncHandler(ctrl.daily));
>>"src\routes\api\statistics.routes.js" echo router.get('/weekly', asyncHandler(ctrl.weekly));
>>"src\routes\api\statistics.routes.js" echo router.get('/monthly', asyncHandler(ctrl.monthly));
>>"src\routes\api\statistics.routes.js" echo router.get('/user/:discordId', asyncHandler(ctrl.user));
>>"src\routes\api\statistics.routes.js" echo router.get('/members', asyncHandler(ctrl.members));
>>"src\routes\api\statistics.routes.js" echo.
>>"src\routes\api\statistics.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\reports.routes.js
REM ============================================================
echo [14/20] reports.routes.js
> "src\routes\api\reports.routes.js" echo import { Router } from 'express';
>>"src\routes\api\reports.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\reports.routes.js" echo import * as ctrl from '../../controllers/report.controller.js';
>>"src\routes\api\reports.routes.js" echo.
>>"src\routes\api\reports.routes.js" echo const router = Router();
>>"src\routes\api\reports.routes.js" echo.
>>"src\routes\api\reports.routes.js" echo router.get('/', asyncHandler(ctrl.list));
>>"src\routes\api\reports.routes.js" echo router.post('/weekly', asyncHandler(ctrl.generateWeekly));
>>"src\routes\api\reports.routes.js" echo router.post('/monthly', asyncHandler(ctrl.generateMonthly));
>>"src\routes\api\reports.routes.js" echo router.post('/manual', asyncHandler(ctrl.generateManual));
>>"src\routes\api\reports.routes.js" echo router.get('/:id', asyncHandler(ctrl.get));
>>"src\routes\api\reports.routes.js" echo.
>>"src\routes\api\reports.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\settings.routes.js
REM ============================================================
echo [15/20] settings.routes.js
> "src\routes\api\settings.routes.js" echo import { Router } from 'express';
>>"src\routes\api\settings.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\settings.routes.js" echo import * as ctrl from '../../controllers/settings.controller.js';
>>"src\routes\api\settings.routes.js" echo.
>>"src\routes\api\settings.routes.js" echo const router = Router();
>>"src\routes\api\settings.routes.js" echo.
>>"src\routes\api\settings.routes.js" echo router.get('/', asyncHandler(ctrl.getSettings));
>>"src\routes\api\settings.routes.js" echo router.get('/paths', asyncHandler(ctrl.listPaths));
>>"src\routes\api\settings.routes.js" echo router.patch('/', asyncHandler(ctrl.patchSettings));
>>"src\routes\api\settings.routes.js" echo router.post('/reset', asyncHandler(ctrl.resetSetting));
>>"src\routes\api\settings.routes.js" echo.
>>"src\routes\api\settings.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\audit.routes.js
REM ============================================================
echo [16/20] audit.routes.js
> "src\routes\api\audit.routes.js" echo import { Router } from 'express';
>>"src\routes\api\audit.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\audit.routes.js" echo import * as ctrl from '../../controllers/audit.controller.js';
>>"src\routes\api\audit.routes.js" echo.
>>"src\routes\api\audit.routes.js" echo const router = Router();
>>"src\routes\api\audit.routes.js" echo.
>>"src\routes\api\audit.routes.js" echo router.get('/', asyncHandler(ctrl.query));
>>"src\routes\api\audit.routes.js" echo router.get('/summary', asyncHandler(ctrl.summary));
>>"src\routes\api\audit.routes.js" echo router.get('/categories', asyncHandler(ctrl.categories));
>>"src\routes\api\audit.routes.js" echo router.get('/actions', asyncHandler(ctrl.actions));
>>"src\routes\api\audit.routes.js" echo router.get('/:id', asyncHandler(ctrl.get));
>>"src\routes\api\audit.routes.js" echo.
>>"src\routes\api\audit.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\sync.routes.js
REM ============================================================
echo [17/20] sync.routes.js
> "src\routes\api\sync.routes.js" echo import { Router } from 'express';
>>"src\routes\api\sync.routes.js" echo import { asyncHandler } from '../../utils/asyncHandler.js';
>>"src\routes\api\sync.routes.js" echo import * as ctrl from '../../controllers/sync.controller.js';
>>"src\routes\api\sync.routes.js" echo.
>>"src\routes\api\sync.routes.js" echo const router = Router();
>>"src\routes\api\sync.routes.js" echo.
>>"src\routes\api\sync.routes.js" echo router.post('/roblox', asyncHandler(ctrl.trigger));
>>"src\routes\api\sync.routes.js" echo router.get('/status', asyncHandler(ctrl.status));
>>"src\routes\api\sync.routes.js" echo.
>>"src\routes\api\sync.routes.js" echo export default router;

REM ============================================================
REM  src\routes\api\index.js
REM ============================================================
echo [18/20] api/index.js
> "src\routes\api\index.js" echo import { Router } from 'express';
>>"src\routes\api\index.js" echo import { apiKey } from '../../middleware/apiKey.js';
>>"src\routes\api\index.js" echo import users from './users.routes.js';
>>"src\routes\api\index.js" echo import roles from './roles.routes.js';
>>"src\routes\api\index.js" echo import permissions from './permissions.routes.js';
>>"src\routes\api\index.js" echo import events from './events.routes.js';
>>"src\routes\api\index.js" echo import eventTypes from './eventTypes.routes.js';
>>"src\routes\api\index.js" echo import attendance from './attendance.routes.js';
>>"src\routes\api\index.js" echo import quota from './quota.routes.js';
>>"src\routes\api\index.js" echo import strikes from './strikes.routes.js';
>>"src\routes\api\index.js" echo import removals from './removals.routes.js';
>>"src\routes\api\index.js" echo import leaves from './leaves.routes.js';
>>"src\routes\api\index.js" echo import notices from './notices.routes.js';
>>"src\routes\api\index.js" echo import statistics from './statistics.routes.js';
>>"src\routes\api\index.js" echo import reports from './reports.routes.js';
>>"src\routes\api\index.js" echo import settings from './settings.routes.js';
>>"src\routes\api\index.js" echo import audit from './audit.routes.js';
>>"src\routes\api\index.js" echo import sync from './sync.routes.js';
>>"src\routes\api\index.js" echo.
>>"src\routes\api\index.js" echo const router = Router();
>>"src\routes\api\index.js" echo.
>>"src\routes\api\index.js" echo router.use(apiKey);
>>"src\routes\api\index.js" echo.
>>"src\routes\api\index.js" echo router.use('/users', users);
>>"src\routes\api\index.js" echo router.use('/roles', roles);
>>"src\routes\api\index.js" echo router.use('/permissions', permissions);
>>"src\routes\api\index.js" echo router.use('/events', events);
>>"src\routes\api\index.js" echo router.use('/event-types', eventTypes);
>>"src\routes\api\index.js" echo router.use('/attendance', attendance);
>>"src\routes\api\index.js" echo router.use('/quota', quota);
>>"src\routes\api\index.js" echo router.use('/strikes', strikes);
>>"src\routes\api\index.js" echo router.use('/removals', removals);
>>"src\routes\api\index.js" echo router.use('/leaves', leaves);
>>"src\routes\api\index.js" echo router.use('/notices', notices);
>>"src\routes\api\index.js" echo router.use('/statistics', statistics);
>>"src\routes\api\index.js" echo router.use('/reports', reports);
>>"src\routes\api\index.js" echo router.use('/settings', settings);
>>"src\routes\api\index.js" echo router.use('/audit', audit);
>>"src\routes\api\index.js" echo router.use('/sync', sync);
>>"src\routes\api\index.js" echo.
>>"src\routes\api\index.js" echo export default router;

REM ============================================================
REM  src\routes\index.js
REM ============================================================
echo [19/20] routes/index.js
> "src\routes\index.js" echo import { Router } from 'express';
>>"src\routes\index.js" echo import healthRoutes from './health.routes.js';
>>"src\routes\index.js" echo import apiRoutes from './api/index.js';
>>"src\routes\index.js" echo.
>>"src\routes\index.js" echo const router = Router();
>>"src\routes\index.js" echo.
>>"src\routes\index.js" echo router.use('/health', healthRoutes);
>>"src\routes\index.js" echo router.use('/api', apiRoutes);
>>"src\routes\index.js" echo.
>>"src\routes\index.js" echo export default router;

REM ============================================================
REM  src\config\index.js
REM ============================================================
echo [20/20] config/index.js
> "src\config\index.js" echo import dotenv from 'dotenv';
>>"src\config\index.js" echo.
>>"src\config\index.js" echo dotenv.config();
>>"src\config\index.js" echo.
>>"src\config\index.js" echo function required(key) {
>>"src\config\index.js" echo   const value = process.env[key];
>>"src\config\index.js" echo   if (value === undefined || value === '') {
>>"src\config\index.js" echo     throw new Error('Missing required environment variable: ' + key);
>>"src\config\index.js" echo   }
>>"src\config\index.js" echo   return value;
>>"src\config\index.js" echo }
>>"src\config\index.js" echo.
>>"src\config\index.js" echo function optional(key, fallback) {
>>"src\config\index.js" echo   const value = process.env[key];
>>"src\config\index.js" echo   return value === undefined || value === '' ? fallback : value;
>>"src\config\index.js" echo }
>>"src\config\index.js" echo.
>>"src\config\index.js" echo const config = {
>>"src\config\index.js" echo   env: optional('NODE_ENV', 'development'),
>>"src\config\index.js" echo   isProduction: optional('NODE_ENV', 'development') === 'production',
>>"src\config\index.js" echo   isTest: optional('NODE_ENV', 'development') === 'test',
>>"src\config\index.js" echo   port: parseInt(optional('PORT', '3000'), 10),
>>"src\config\index.js" echo   mongo: {
>>"src\config\index.js" echo     uri: required('MONGODB_URI'),
>>"src\config\index.js" echo   },
>>"src\config\index.js" echo   discord: {
>>"src\config\index.js" echo     token: required('DISCORD_TOKEN'),
>>"src\config\index.js" echo     clientId: required('DISCORD_CLIENT_ID'),
>>"src\config\index.js" echo     guildId: required('DISCORD_GUILD_ID'),
>>"src\config\index.js" echo   },
>>"src\config\index.js" echo   roblox: {
>>"src\config\index.js" echo     groupId: required('ROBLOX_GROUP_ID'),
>>"src\config\index.js" echo   },
>>"src\config\index.js" echo   timezone: optional('DEFAULT_TIMEZONE', 'Asia/Kolkata'),
>>"src\config\index.js" echo   cron: {
>>"src\config\index.js" echo     robloxSync: optional('ROBLOX_SYNC_CRON', '0 */6 * * *'),
>>"src\config\index.js" echo     quotaEvaluation: optional('QUOTA_EVALUATION_CRON', '30 23 * * 0'),
>>"src\config\index.js" echo     weeklyReport: optional('WEEKLY_REPORT_CRON', '0 22 * * 0'),
>>"src\config\index.js" echo     expirationSweep: optional('EXPIRATION_SWEEP_CRON', '*/15 * * * *'),
>>"src\config\index.js" echo     removalSweep: optional('REMOVAL_SWEEP_CRON', '5 0 * * *'),
>>"src\config\index.js" echo     cleanup: optional('CLEANUP_CRON', '0 3 * * *'),
>>"src\config\index.js" echo   },
>>"src\config\index.js" echo   log: {
>>"src\config\index.js" echo     level: optional('LOG_LEVEL', 'info'),
>>"src\config\index.js" echo   },
>>"src\config\index.js" echo   api: {
>>"src\config\index.js" echo     key: optional('API_KEY', null),
>>"src\config\index.js" echo   },
>>"src\config\index.js" echo };
>>"src\config\index.js" echo.
>>"src\config\index.js" echo export default Object.freeze(config);

REM ============================================================
REM  Verify
REM ============================================================
echo.
echo ============================================================
echo   Verificationecho ============================================================
echo.
echo Files in src\routes\api:
dir /b "src\routes\api"
echo.
echo Files in src\middleware:
dir /b "src\middleware"
echo.
echo apiKey.js size:
dir "src\middleware\apiKey.js" | find "apiKey"
echo.
echo api\index.js size:
dir "src\routes\api\index.js" | find "index"
echo.
pause
endlocal
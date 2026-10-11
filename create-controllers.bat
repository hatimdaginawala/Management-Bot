@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

REM ============================================================
REM  Controllers Scaffold - 24th Guard Rifles Management Bot
REM  Creates all 15 REST controllers in src\controllers\
REM ============================================================

set "ROOT=%~dp0"
set "DIR=%ROOT%src\controllers"

if not exist "%DIR%" (
    echo Creating folder: %DIR%
    mkdir "%DIR%"
)

echo.
echo ============================================================
echo   Controllers Scaffold
echo ============================================================
echo   Target: %DIR%
echo.

REM ============================================================
REM  user.controller.js
REM ============================================================
echo Writing user.controller.js...
(
echo import * as userService from '../services/user.service.js';
echo.
echo export async function listUsers^(req, res^) {
echo   const result = await userService.listMembers^({
echo     status: req.query.status,
echo     roleKey: req.query.roleKey,
echo     quotaCategory: req.query.quotaCategory,
echo     search: req.query.search,
echo     page: req.query.page,
echo     pageSize: req.query.pageSize,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function getUser^(req, res^) {
echo   const profile = await userService.getMemberProfile^(req.params.discordId^);
echo   if ^(!profile^) {
echo     return res.status^(404^).json^({
echo       success: false,
echo       error: { code: 'NOT_FOUND', message: 'User not found.' },
echo     }^);
echo   }
echo   res.json^({ success: true, data: profile }^);
echo }
echo.
echo export async function getUserHistory^(req, res^) {
echo   const history = await userService.getMemberHistory^(req.params.discordId, {
echo     limit: req.query.limit,
echo   }^);
echo   if ^(!history^) {
echo     return res.status^(404^).json^({
echo       success: false,
echo       error: { code: 'NOT_FOUND', message: 'User not found.' },
echo     }^);
echo   }
echo   res.json^({ success: true, data: history }^);
echo }
) > "%DIR%\user.controller.js"

REM ============================================================
REM  role.controller.js
REM ============================================================
echo Writing role.controller.js...
(
echo import * as roleService from '../services/role.service.js';
echo.
echo export async function listRoles^(req, res^) {
echo   const items = await roleService.listRoles^({
echo     includeInactive: req.query.includeInactive === 'true',
echo   }^);
echo   res.json^({ success: true, data: items }^);
echo }
echo.
echo export async function getRole^(req, res^) {
echo   const role = await roleService.getRoleByKey^(req.params.key^);
echo   res.json^({ success: true, data: role }^);
echo }
echo.
echo export async function createRole^(req, res^) {
echo   const role = await roleService.createRole^(req.body.actorId, {
echo     key: req.body.key,
echo     name: req.body.name,
echo     description: req.body.description,
echo     permissions: req.body.permissions,
echo     priority: req.body.priority,
echo     quotaCategory: req.body.quotaCategory,
echo   }^);
echo   res.status^(201^).json^({ success: true, data: role.toObject^(^) }^);
echo }
echo.
echo export async function editRole^(req, res^) {
echo   const patch = req.body.patch ?? req.body;
echo   const role = await roleService.editRole^(req.body.actorId, req.params.key, patch^);
echo   res.json^({ success: true, data: role.toObject^(^) }^);
echo }
echo.
echo export async function deleteRole^(req, res^) {
echo   const removed = await roleService.deleteRole^(req.body.actorId, req.params.key^);
echo   res.json^({ success: true, data: removed }^);
echo }
echo.
echo export async function assignRole^(req, res^) {
echo   const result = await roleService.assignRole^(
echo     req.body.actorId,
echo     req.body.discordId,
echo     req.params.key,
echo     { reason: req.body.reason }
echo   ^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function removeRole^(req, res^) {
echo   const result = await roleService.removeRole^(
echo     req.body.actorId,
echo     req.body.discordId,
echo     req.params.key,
echo     { reason: req.body.reason }
echo   ^);
echo   res.json^({ success: true, data: result }^);
echo }
) > "%DIR%\role.controller.js"

REM ============================================================
REM  permission.controller.js
REM ============================================================
echo Writing permission.controller.js...
(
echo import { Permission } from '../models/index.js';
echo import * as permissionService from '../services/permission.service.js';
echo.
echo export async function listPermissions^(req, res^) {
echo   const items = await Permission.find^({}^).sort^({ category: 1, key: 1 }^).lean^(^);
echo   res.json^({ success: true, data: items }^);
echo }
echo.
echo export async function getEffectivePermissions^(req, res^) {
echo   const perms = await permissionService.getEffectivePermissionsByDiscordId^(
echo     req.params.discordId
echo   ^);
echo   res.json^({ success: true, data: Array.from^(perms^).sort^(^) }^);
echo }
) > "%DIR%\permission.controller.js"

REM ============================================================
REM  event.controller.js
REM ============================================================
echo Writing event.controller.js...
(
echo import * as eventService from '../services/event.service.js';
echo.
echo export async function listEvents^(req, res^) {
echo   const result = await eventService.listEvents^({
echo     status: req.query.status,
echo     hostDiscordId: req.query.hostDiscordId,
echo     eventTypeKey: req.query.eventTypeKey,
echo     from: req.query.from ? new Date^(req.query.from^) : undefined,
echo     to: req.query.to ? new Date^(req.query.to^) : undefined,
echo     page: req.query.page,
echo     pageSize: req.query.pageSize,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function getEvent^(req, res^) {
echo   const event = await eventService.getEvent^(req.params.id^);
echo   res.json^({ success: true, data: event }^);
echo }
echo.
echo export async function createEvent^(req, res^) {
echo   const event = await eventService.createEvent^(req.body.hostDiscordId, {
echo     eventTypeKey: req.body.eventTypeKey,
echo     attendees: req.body.attendees,
echo     proofUrl: req.body.proofUrl,
echo     notes: req.body.notes,
echo   }^);
echo   res.status^(201^).json^({ success: true, data: event.toObject^(^) }^);
echo }
echo.
echo export async function approveEvent^(req, res^) {
echo   const result = await eventService.approveEvent^(req.body.actorId, req.params.id^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function rejectEvent^(req, res^) {
echo   const event = await eventService.rejectEvent^(req.body.actorId, req.params.id, {
echo     reason: req.body.reason,
echo   }^);
echo   res.json^({ success: true, data: event }^);
echo }
echo.
echo export async function cancelEvent^(req, res^) {
echo   const event = await eventService.cancelEvent^(req.body.actorId, req.params.id, {
echo     reason: req.body.reason,
echo   }^);
echo   res.json^({ success: true, data: event }^);
echo }
echo.
echo export async function updateEvent^(req, res^) {
echo   const event = await eventService.updateEvent^(req.body.actorId, req.params.id, {
echo     proofUrl: req.body.proofUrl,
echo     notes: req.body.notes,
echo     attendees: req.body.attendees,
echo   }^);
echo   res.json^({ success: true, data: event }^);
echo }
) > "%DIR%\event.controller.js"

REM ============================================================
REM  eventType.controller.js
REM ============================================================
echo Writing eventType.controller.js...
(
echo import * as eventTypeService from '../services/eventType.service.js';
echo.
echo export async function listEventTypes^(req, res^) {
echo   const items = await eventTypeService.listEventTypes^({
echo     includeInactive: req.query.includeInactive === 'true',
echo   }^);
echo   res.json^({ success: true, data: items }^);
echo }
) > "%DIR%\eventType.controller.js"

REM ============================================================
REM  attendance.controller.js
REM ============================================================
echo Writing attendance.controller.js...
(
echo import * as attendanceService from '../services/attendance.service.js';
echo.
echo export async function listAttendance^(req, res^) {
echo   const result = await attendanceService.listAttendance^({
echo     userDiscordId: req.query.userDiscordId,
echo     eventId: req.query.eventId,
echo     eventTypeKey: req.query.eventTypeKey,
echo     from: req.query.from ? new Date^(req.query.from^) : undefined,
echo     to: req.query.to ? new Date^(req.query.to^) : undefined,
echo     includeInactive: req.query.includeInactive === 'true',
echo     page: req.query.page,
echo     pageSize: req.query.pageSize,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function getHistory^(req, res^) {
echo   const result = await attendanceService.getAttendanceHistory^(
echo     req.params.discordId,
echo     { limit: req.query.limit }
echo   ^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function getStats^(req, res^) {
echo   const result = await attendanceService.attendanceStats^({
echo     mode: req.query.mode,
echo     from: req.query.from ? new Date^(req.query.from^) : undefined,
echo     to: req.query.to ? new Date^(req.query.to^) : undefined,
echo     limit: req.query.limit,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function addManual^(req, res^) {
echo   const record = await attendanceService.addManualAttendance^(req.body.actorId, {
echo     eventId: req.body.eventId,
echo     userDiscordId: req.body.userDiscordId,
echo     reason: req.body.reason,
echo   }^);
echo   res.status^(201^).json^({ success: true, data: record }^);
echo }
echo.
echo export async function removeManual^(req, res^) {
echo   const record = await attendanceService.removeManualAttendance^(req.body.actorId, {
echo     eventId: req.body.eventId,
echo     userDiscordId: req.body.userDiscordId,
echo     reason: req.body.reason,
echo   }^);
echo   res.json^({ success: true, data: record }^);
echo }
) > "%DIR%\attendance.controller.js"

REM ============================================================
REM  quota.controller.js
REM ============================================================
echo Writing quota.controller.js...
(
echo import * as quotaPolicyService from '../services/quotaPolicy.service.js';
echo import * as quotaPeriodService from '../services/quotaPeriod.service.js';
echo import { QuotaPeriod } from '../models/index.js';
echo.
echo export async function listPolicies^(req, res^) {
echo   const items = await quotaPolicyService.listPolicies^({
echo     category: req.query.category,
echo     includeExpired: req.query.includeExpired !== 'false',
echo   }^);
echo   res.json^({ success: true, data: items }^);
echo }
echo.
echo export async function setPolicy^(req, res^) {
echo   const policy = await quotaPolicyService.setPolicy^(req.body.actorId, {
echo     category: req.body.category,
echo     amount: req.body.amount,
echo     metric: req.body.metric,
echo     recoveryMultiplier: req.body.recoveryMultiplier,
echo     notes: req.body.notes,
echo   }^);
echo   res.status^(201^).json^({ success: true, data: policy.toObject^(^) }^);
echo }
echo.
echo export async function listPeriods^(req, res^) {
echo   const items = await QuotaPeriod.find^({}^).sort^({ startAt: -1 }^).limit^(50^).lean^(^);
echo   res.json^({ success: true, data: items }^);
echo }
echo.
echo export async function getPeriod^(req, res^) {
echo   const period = await quotaPeriodService.getPeriodByKey^(req.params.key^);
echo   res.json^({ success: true, data: period }^);
echo }
) > "%DIR%\quota.controller.js"

REM ============================================================
REM  strike.controller.js
REM ============================================================
echo Writing strike.controller.js...
(
echo import * as strikeService from '../services/strike.service.js';
echo.
echo export async function getActive^(req, res^) {
echo   const items = await strikeService.getActiveStrikes^(req.params.discordId^);
echo   res.json^({ success: true, data: items }^);
echo }
echo.
echo export async function getHistory^(req, res^) {
echo   const items = await strikeService.getStrikeHistory^(req.params.discordId, {
echo     limit: req.query.limit,
echo   }^);
echo   res.json^({ success: true, data: items }^);
echo }
echo.
echo export async function issueManual^(req, res^) {
echo   const strike = await strikeService.issueManualStrike^(req.body.actorId, {
echo     targetDiscordId: req.body.targetDiscordId,
echo     reason: req.body.reason,
echo   }^);
echo   res.status^(201^).json^({ success: true, data: strike.toObject^(^) }^);
echo }
echo.
echo export async function removeStrike^(req, res^) {
echo   const result = await strikeService.removeStrike^(req.body.actorId, req.params.id, {
echo     reason: req.body.reason,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function recoverStrike^(req, res^) {
echo   const result = await strikeService.recoverStrike^(req.body.actorId, req.params.id, {
echo     reason: req.body.reason,
echo     periodKey: req.body.periodKey,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
) > "%DIR%\strike.controller.js"

REM ============================================================
REM  removal.controller.js
REM ============================================================
echo Writing removal.controller.js...
(
echo import * as removalRequestService from '../services/removalRequest.service.js';
echo.
echo export async function listPending^(req, res^) {
echo   const result = await removalRequestService.listPendingRemovals^({
echo     page: req.query.page,
echo     pageSize: req.query.pageSize,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function createManual^(req, res^) {
echo   const request = await removalRequestService.createManual^(req.body.actorId, {
echo     targetDiscordId: req.body.targetDiscordId,
echo     description: req.body.description,
echo   }^);
echo   res.status^(201^).json^({ success: true, data: request }^);
echo }
echo.
echo export async function approve^(req, res^) {
echo   const request = await removalRequestService.approveRemoval^(req.body.actorId, req.params.id, {
echo     reason: req.body.reason,
echo     effectiveAt: req.body.effectiveAt ? new Date^(req.body.effectiveAt^) : null,
echo   }^);
echo   res.json^({ success: true, data: request }^);
echo }
echo.
echo export async function dismiss^(req, res^) {
echo   const request = await removalRequestService.dismissRemoval^(req.body.actorId, req.params.id, {
echo     reason: req.body.reason,
echo   }^);
echo   res.json^({ success: true, data: request }^);
echo }
) > "%DIR%\removal.controller.js"

REM ============================================================
REM  leave.controller.js
REM ============================================================
echo Writing leave.controller.js...
(
echo import * as leaveService from '../services/leave.service.js';
echo.
echo export async function list^(req, res^) {
echo   const result = await leaveService.listLeaves^({
echo     status: req.query.status,
echo     discordId: req.query.discordId,
echo     page: req.query.page,
echo     pageSize: req.query.pageSize,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function create^(req, res^) {
echo   const leave = await leaveService.createLeaveRequest^(req.body.discordId, {
echo     startAt: req.body.startAt ? new Date^(req.body.startAt^) : null,
echo     endAt: req.body.endAt ? new Date^(req.body.endAt^) : null,
echo     reason: req.body.reason,
echo     notes: req.body.notes,
echo   }^);
echo   res.status^(201^).json^({ success: true, data: leave }^);
echo }
echo.
echo export async function approve^(req, res^) {
echo   const result = await leaveService.approveLeave^(req.body.actorId, req.params.id, {
echo     reason: req.body.reason,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function reject^(req, res^) {
echo   const leave = await leaveService.rejectLeave^(req.body.actorId, req.params.id, {
echo     reason: req.body.reason,
echo   }^);
echo   res.json^({ success: true, data: leave }^);
echo }
echo.
echo export async function end^(req, res^) {
echo   const result = await leaveService.endLeave^(req.body.actorId, req.params.id, {
echo     reason: req.body.reason,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
) > "%DIR%\leave.controller.js"

REM ============================================================
REM  notice.controller.js
REM ============================================================
echo Writing notice.controller.js...
(
echo import * as noticeService from '../services/notice.service.js';
echo.
echo export async function list^(req, res^) {
echo   const result = await noticeService.listNotices^({
echo     status: req.query.status,
echo     discordId: req.query.discordId,
echo     type: req.query.type,
echo     page: req.query.page,
echo     pageSize: req.query.pageSize,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function create^(req, res^) {
echo   const notice = await noticeService.createNotice^(req.body.actorId, {
echo     targetDiscordId: req.body.targetDiscordId,
echo     type: req.body.type,
echo     reason: req.body.reason,
echo     startAt: req.body.startAt ? new Date^(req.body.startAt^) : null,
echo     endAt: req.body.endAt ? new Date^(req.body.endAt^) : null,
echo     grantsQuotaExemption: req.body.grantsQuotaExemption,
echo     notes: req.body.notes,
echo   }^);
echo   res.status^(201^).json^({ success: true, data: notice }^);
echo }
echo.
echo export async function cancel^(req, res^) {
echo   const result = await noticeService.cancelNotice^(req.body.actorId, req.params.id, {
echo     reason: req.body.reason,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
) > "%DIR%\notice.controller.js"

REM ============================================================
REM  statistics.controller.js
REM ============================================================
echo Writing statistics.controller.js...
(
echo import * as statisticsService from '../services/statistics.service.js';
echo.
echo export async function daily^(req, res^) {
echo   const result = await statisticsService.dailyStats^({
echo     asOf: req.query.asOf ? new Date^(req.query.asOf^) : undefined,
echo     top: req.query.top,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function weekly^(req, res^) {
echo   const result = await statisticsService.weeklyStats^({
echo     asOf: req.query.asOf ? new Date^(req.query.asOf^) : undefined,
echo     top: req.query.top,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function monthly^(req, res^) {
echo   const result = await statisticsService.monthlyStats^({
echo     asOf: req.query.asOf ? new Date^(req.query.asOf^) : undefined,
echo     top: req.query.top,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function user^(req, res^) {
echo   const result = await statisticsService.userStats^(req.params.discordId^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function members^(req, res^) {
echo   const result = await statisticsService.memberBreakdown^(^);
echo   res.json^({ success: true, data: result }^);
echo }
) > "%DIR%\statistics.controller.js"

REM ============================================================
REM  report.controller.js
REM ============================================================
echo Writing report.controller.js...
(
echo import * as reportService from '../services/report.service.js';
echo.
echo export async function list^(req, res^) {
echo   const result = await reportService.listReports^({
echo     kind: req.query.kind,
echo     page: req.query.page,
echo     pageSize: req.query.pageSize,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function get^(req, res^) {
echo   const report = await reportService.getReportById^(req.params.id^);
echo   res.json^({ success: true, data: report }^);
echo }
echo.
echo export async function generateWeekly^(req, res^) {
echo   const report = await reportService.generateWeeklyReport^({
echo     asOf: req.body.asOf ? new Date^(req.body.asOf^) : new Date^(^),
echo     generatedBy: req.body.actorId || 'api',
echo   }^);
echo   res.status^(201^).json^({ success: true, data: report }^);
echo }
echo.
echo export async function generateMonthly^(req, res^) {
echo   const report = await reportService.generateMonthlyReport^({
echo     asOf: req.body.asOf ? new Date^(req.body.asOf^) : new Date^(^),
echo     generatedBy: req.body.actorId || 'api',
echo   }^);
echo   res.status^(201^).json^({ success: true, data: report }^);
echo }
echo.
echo export async function generateManual^(req, res^) {
echo   const report = await reportService.generateManualReport^({
echo     from: req.body.from ? new Date^(req.body.from^) : null,
echo     to: req.body.to ? new Date^(req.body.to^) : null,
echo     generatedBy: req.body.actorId || 'api',
echo     label: req.body.label,
echo   }^);
echo   res.status^(201^).json^({ success: true, data: report }^);
echo }
) > "%DIR%\report.controller.js"

REM ============================================================
REM  settings.controller.js
REM ============================================================
echo Writing settings.controller.js...
(
echo import * as settingsService from '../services/settings.service.js';
echo.
echo export async function getSettings^(req, res^) {
echo   const doc = await settingsService.getSettings^(^);
echo   res.json^({ success: true, data: doc }^);
echo }
echo.
echo export async function listPaths^(req, res^) {
echo   const { rows } = await settingsService.describeSettings^(^);
echo   res.json^({ success: true, data: rows }^);
echo }
echo.
echo export async function patchSettings^(req, res^) {
echo   const actorId = req.body.actorId || 'api';
echo   const patch = req.body.patch || {};
echo   const result = await settingsService.setSettings^(actorId, patch, {
echo     reason: req.body.reason || null,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function resetSetting^(req, res^) {
echo   const actorId = req.body.actorId || 'api';
echo   const value = await settingsService.resetSetting^(actorId, req.body.path, {
echo     reason: req.body.reason || null,
echo   }^);
echo   res.json^({ success: true, data: { path: req.body.path, value } }^);
echo }
) > "%DIR%\settings.controller.js"

REM ============================================================
REM  audit.controller.js
REM ============================================================
echo Writing audit.controller.js...
(
echo import * as auditService from '../services/audit.service.js';
echo.
echo export async function query^(req, res^) {
echo   const result = await auditService.queryLogs^({
echo     actorId: req.query.actorId,
echo     action: req.query.action,
echo     category: req.query.category,
echo     targetType: req.query.targetType,
echo     targetId: req.query.targetId,
echo     from: req.query.from ? new Date^(req.query.from^) : undefined,
echo     to: req.query.to ? new Date^(req.query.to^) : undefined,
echo     page: req.query.page,
echo     pageSize: req.query.pageSize,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function get^(req, res^) {
echo   const entry = await auditService.getEntry^(req.params.id^);
echo   res.json^({ success: true, data: entry }^);
echo }
echo.
echo export async function summary^(req, res^) {
echo   const result = await auditService.summarize^({
echo     from: req.query.from ? new Date^(req.query.from^) : undefined,
echo     to: req.query.to ? new Date^(req.query.to^) : undefined,
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function categories^(req, res^) {
echo   const result = await auditService.listCategories^(^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function actions^(req, res^) {
echo   const result = await auditService.listActions^({ category: req.query.category }^);
echo   res.json^({ success: true, data: result }^);
echo }
) > "%DIR%\audit.controller.js"

REM ============================================================
REM  sync.controller.js
REM ============================================================
echo Writing sync.controller.js...
(
echo import { runJobSync } from '../jobs/runner.js';
echo import { SyncLog } from '../models/index.js';
echo.
echo export async function trigger^(req, res^) {
echo   const result = await runJobSync^('roblox-sync', {
echo     triggeredBy: req.body.triggeredBy || 'api',
echo   }^);
echo   res.json^({ success: true, data: result }^);
echo }
echo.
echo export async function status^(req, res^) {
echo   const latest = await SyncLog.findOne^({ type: 'ROBLOX_GROUP_SYNC' }^)
echo     .sort^({ startedAt: -1 }^)
echo     .lean^(^);
echo   res.json^({ success: true, data: latest || null }^);
echo }
) > "%DIR%\sync.controller.js"

echo.
echo ============================================================
echo   Controllers scaffold complete.
echo ============================================================
echo.
echo Files written to: %DIR%
echo.
dir /b "%DIR%"
echo.
pause
endlocal
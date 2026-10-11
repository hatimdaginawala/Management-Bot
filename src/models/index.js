// ============================================================
//  Mongoose model registry.
//  Importing this file registers every schema with Mongoose.
//  `src/server.js` imports it once at boot.
// ============================================================

// ----- Phase 2A: core identity, RBAC, events, attendance -----
export { User } from './User.js';
export { Verification } from './Verification.js';
export { Role } from './Role.js';
export { Permission } from './Permission.js';
export { RoleAssignment } from './RoleAssignment.js';
export { Event } from './Event.js';
export { EventType } from './EventType.js';
export { Attendance } from './Attendance.js';

// ----- Phase 2B: quotas, strikes, leave, notice, removal, settings -----
export { QuotaPolicy, QUOTA_METRIC, QUOTA_PERIOD_KIND } from './QuotaPolicy.js';
export { QuotaPeriod } from './QuotaPeriod.js';
export { QuotaResult } from './QuotaResult.js';
export { Strike } from './Strike.js';
export { Leave } from './Leave.js';
export { Notice } from './Notice.js';
export { RemovalRequest } from './RemovalRequest.js';
export { Settings } from './Settings.js';

// ----- Phase 2C: append-only history & reporting -----
export { AuditLog } from './AuditLog.js';
export { RankHistory } from './RankHistory.js';
export { SyncLog } from './SyncLog.js';
export { Report } from './Report.js';

// ----- Shared enums (re-exported for convenience) -----
export * from './enums.js';
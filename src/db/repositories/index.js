/**
 * Repository namespace.
 */

// M3A — identity
export * as userRepository from './user.repository.js';
export * as verificationRepository from './verification.repository.js';
export * as roleRepository from './role.repository.js';
export * as permissionRepository from './permission.repository.js';
export * as roleAssignmentRepository from './roleAssignment.repository.js';

// M3B — events + attendance
export * as eventRepository from './event.repository.js';
export * as eventTypeRepository from './eventType.repository.js';
export * as eventAttendeeRepository from './eventAttendee.repository.js';
export * as attendanceRepository from './attendance.repository.js';

// M3C — quotas + strikes + leaves + notices + removals
export * as quotaPolicyRepository from './quotaPolicy.repository.js';
export * as quotaPeriodRepository from './quotaPeriod.repository.js';
export * as quotaPeriodPolicyRepository from './quotaPeriodPolicy.repository.js';
export * as quotaResultRepository from './quotaResult.repository.js';
export * as strikeRepository from './strike.repository.js';
export * as leaveRepository from './leave.repository.js';
export * as noticeRepository from './notice.repository.js';
export * as removalRequestRepository from './removalRequest.repository.js';

// M3D — settings, audit, history, reporting
export * as settingsRepository from './settings.repository.js';
export * as auditLogRepository from './auditLog.repository.js';
export * as rankHistoryRepository from './rankHistory.repository.js';
export * as syncLogRepository from './syncLog.repository.js';
export * as reportRepository from './report.repository.js';
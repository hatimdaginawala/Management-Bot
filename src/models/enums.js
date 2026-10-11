/**
 * Shared enums used across Mongoose models.
 * Kept in one place so schemas and services stay consistent.
 */

export const USER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  LEFT_ROBLOX_GROUP: 'LEFT_ROBLOX_GROUP',
  UNVERIFIED: 'UNVERIFIED',
  SUSPENDED: 'SUSPENDED',
  INACTIVE: 'INACTIVE',
});

export const QUOTA_CATEGORY = Object.freeze({
  NONE: 'NONE',
  STAFF: 'STAFF',
  LOW_RANK: 'LOW_RANK',
});

export const VERIFICATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
});

export const EVENT_TYPE_NAME = Object.freeze({
  PATROL: 'Patrol',
  CT: 'CT',
  DT: 'DT',
  RAID: 'Raid',
  TRYOUT: 'Tryout',
  OTHER: 'Other',
});

export const EVENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
});

export const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: 'PRESENT',
  MANUAL_ADDED: 'MANUAL_ADDED',
  MANUAL_REMOVED: 'MANUAL_REMOVED',
});

export const ROLE_KIND = Object.freeze({
  SYSTEM: 'SYSTEM',
  CUSTOM: 'CUSTOM',
});

export const AUDIT_CATEGORY = Object.freeze({
  USER: 'USER',
  ROLE: 'ROLE',
  EVENT: 'EVENT',
  ATTENDANCE: 'ATTENDANCE',
  QUOTA: 'QUOTA',
  STRIKE: 'STRIKE',
  LEAVE: 'LEAVE',
  NOTICE: 'NOTICE',
  REMOVAL: 'REMOVAL',
  SETTINGS: 'SETTINGS',
  SYNC: 'SYNC',
  REPORT: 'REPORT',
});
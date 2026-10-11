/**
 * Application-wide constants.
 * Anything environment-dependent belongs in config/index.js.
 */

export const APP_NAME = '24th Guard Rifles Management Bot';
export const APP_VERSION = '1.0.0';

export const USER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  LEFT_ROBLOX_GROUP: 'LEFT_ROBLOX_GROUP',
  UNVERIFIED: 'UNVERIFIED',
  SUSPENDED: 'SUSPENDED',
  INACTIVE: 'INACTIVE',
});

export const EVENT_TYPES = Object.freeze([
  'Patrol',
  'CT',
  'DT',
  'Raid',
  'Tryout',
  'Other',
]);

export const EVENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
});

export const EVENT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export const QUOTA_CATEGORY = Object.freeze({
  NONE: 'NONE',
  STAFF: 'STAFF',
  LOW_RANK: 'LOW_RANK',
});

export const DEFAULT_ROLE_PRIORITY = Object.freeze({
  super_admin: 1000,
  'Supreme Command': 100,
  'High Command': 80,
  Staff: 40,
  'Low Rank': 10,
});

export const REMOVAL_MIN_ADVANCE_DAYS = 3;
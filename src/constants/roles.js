import { PERMISSION_WILDCARDS as W } from './permissions.js';

/**
 * Seed definitions for the five system roles.
 *
 * Only `super_admin` is `isPermanent: true`. It receives the `*`
 * wildcard, so its effective permission set always includes every
 * existing and future permission (§10).
 *
 * The other four roles are `kind: SYSTEM` so they cannot be deleted
 * via /roles delete, but they CAN be edited (permissions, priority).
 * This matches §51 ("These are defaults and should be implemented
 * through seeded role-permission data, not hard-coded authorization
 * conditions") and §13 (protect system roles appropriately).
 */
export const SYSTEM_ROLE_SEEDS = Object.freeze([
  {
    key: 'super_admin',
    name: 'Super Admin',
    description: 'Permanent system administrator. Bypasses all permission checks.',
    permissions: [W.ALL],
    priority: 1000,
    quotaCategory: 'NONE',
    kind: 'SYSTEM',
    isPermanent: true,
    isEditable: false,
    isDeletable: false,
    active: true,
  },
  {
    key: 'supreme_command',
    name: 'Supreme Command',
    description: 'Highest command tier below super_admin.',
    permissions: [
      W.USERS_ALL,
      W.ROLES_ALL,
      W.EVENTS_ALL,
      W.ATTENDANCE_ALL,
      W.QUOTA_ALL,
      W.STRIKES_ALL,
      W.LEAVE_ALL,
      W.NOTICE_ALL,
      W.REMOVAL_ALL,
      W.REPORTS_ALL,
      W.STATISTICS_ALL,
      W.SETTINGS_ALL,
      W.AUDIT_ALL,
      W.ROBLOX_ALL,
    'verification.manualLink',
    ],
    priority: 100,
    quotaCategory: 'NONE',
    kind: 'SYSTEM',
    isPermanent: false,
    isEditable: true,
    isDeletable: false,
    active: true,
  },
  {
    key: 'high_command',
    name: 'High Command',
    description: 'Senior staff with broad operational and review powers.',
    permissions: [
      'users.view',
      'users.manage',
      'roles.view',
      'roles.assign',
      W.EVENTS_ALL,
      W.ATTENDANCE_ALL,
      W.QUOTA_ALL,
      W.STRIKES_ALL,
      W.LEAVE_ALL,
      W.NOTICE_ALL,
      W.REMOVAL_ALL,
      W.REPORTS_ALL,
      W.STATISTICS_ALL,
      W.SETTINGS_ALL,
      'audit.view',
      'roblox.view',
        'roblox.sync',
      'verification.manualLink',
    ],
    priority: 80,
    quotaCategory: 'NONE',
    kind: 'SYSTEM',
    isPermanent: false,
    isEditable: true,
    isDeletable: false,
    active: true,
  },
  {
    key: 'staff',
    name: 'Staff',
    description: 'Event hosts. Subject to weekly hosting quota.',
    permissions: [
      'events.view',
      'events.create',
      'attendance.view',
      'quota.view',
      'strikes.view',
      'statistics.view',
      'leave.create',
      'notice.view',
    ],
    priority: 40,
    quotaCategory: 'STAFF',
    kind: 'SYSTEM',
    isPermanent: false,
    isEditable: true,
    isDeletable: false,
    active: true,
  },
  {
    key: 'low_rank',
    name: 'Low Rank',
    description: 'Base members. Subject to weekly attendance quota.',
    permissions: [
      'events.view',
      'attendance.view',
      'quota.view',
      'statistics.view',
      'leave.create',
    ],
    priority: 10,
    quotaCategory: 'LOW_RANK',
    kind: 'SYSTEM',
    isPermanent: false,
    isEditable: true,
    isDeletable: false,
    active: true,
  },
]);
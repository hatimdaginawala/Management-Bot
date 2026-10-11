/**
 * Canonical permission catalog.
 *
 * Rules:
 *  - Keys are lowercase, dot-separated: `<category>.<action>`.
 *  - Wildcards are stored as literal strings (e.g. "events.*") and
 *    expanded by the permission resolver at evaluation time.
 *  - Adding a new permission here and re-running `npm run seed`
 *    inserts it into the Permission collection.
 *  - Removing a permission is NOT automatic — a permission removed
 *    from this list remains in the DB and must be manually pruned.
 *    This protects historical role documents.
 */

export const PERMISSION_CATEGORIES = Object.freeze({
  USERS: 'users',
  ROLES: 'roles',
  EVENTS: 'events',
  ATTENDANCE: 'attendance',
  QUOTA: 'quota',
  STRIKES: 'strikes',
  LEAVE: 'leave',
  NOTICE: 'notice',
  REMOVAL: 'removal',
  REPORTS: 'reports',
  STATISTICS: 'statistics',
  SETTINGS: 'settings',
  AUDIT: 'audit',
  ROBLOX: 'roblox',
});

/**
 * The catalog. Each entry becomes a row in the Permission collection
 * on first seed. `isWildcard: true` entries are only used inside role
 * documents — they are not written to Permission as standalone rows
 * unless we explicitly want them listed in the UI. We keep them here
 * so the seed script can also register them for documentation.
 */
export const PERMISSIONS = Object.freeze([
  // ---------- users ----------
  { key: 'users.view',        category: PERMISSION_CATEGORIES.USERS, label: 'View users', description: 'List and inspect user profiles.' },
  { key: 'users.manage',      category: PERMISSION_CATEGORIES.USERS, label: 'Manage users', description: 'Edit user status, quota flags, and identity fields.' },

  // ---------- roles ----------
  { key: 'roles.view',        category: PERMISSION_CATEGORIES.ROLES, label: 'View roles', description: 'List roles and their permissions.' },
  { key: 'roles.create',      category: PERMISSION_CATEGORIES.ROLES, label: 'Create roles', description: 'Create new custom roles.' },
  { key: 'roles.edit',        category: PERMISSION_CATEGORIES.ROLES, label: 'Edit roles', description: 'Change role name, description, permissions, priority.' },
  { key: 'roles.delete',      category: PERMISSION_CATEGORIES.ROLES, label: 'Delete roles', description: 'Delete custom roles.' },
  { key: 'roles.assign',      category: PERMISSION_CATEGORIES.ROLES, label: 'Assign roles', description: 'Assign or remove roles from users.' },

  // ---------- events ----------
  { key: 'events.view',       category: PERMISSION_CATEGORIES.EVENTS, label: 'View events', description: 'View event records.' },
  { key: 'events.create',     category: PERMISSION_CATEGORIES.EVENTS, label: 'Create events', description: 'Log new events with proof and attendees.' },
  { key: 'events.edit',       category: PERMISSION_CATEGORIES.EVENTS, label: 'Edit events', description: 'Edit event metadata (attendees, proof, notes).' },
  { key: 'events.delete',     category: PERMISSION_CATEGORIES.EVENTS, label: 'Delete events', description: 'Delete events (soft-cancel preferred).' },
  { key: 'events.approve',    category: PERMISSION_CATEGORIES.EVENTS, label: 'Approve events', description: 'Approve pending events.' },
  { key: 'events.reject',     category: PERMISSION_CATEGORIES.EVENTS, label: 'Reject events', description: 'Reject pending events with a reason.' },
  { key: 'events.cancel',     category: PERMISSION_CATEGORIES.EVENTS, label: 'Cancel events', description: 'Cancel approved events.' },

  // ---------- attendance ----------
  { key: 'attendance.view',   category: PERMISSION_CATEGORIES.ATTENDANCE, label: 'View attendance', description: 'View attendance records.' },
  { key: 'attendance.manage', category: PERMISSION_CATEGORIES.ATTENDANCE, label: 'Manage attendance', description: 'Manually add or remove attendance.' },

  // ---------- quota ----------
  { key: 'quota.view',        category: PERMISSION_CATEGORIES.QUOTA, label: 'View quota', description: 'View quota policies, periods, and results.' },
  { key: 'quota.manage',      category: PERMISSION_CATEGORIES.QUOTA, label: 'Manage quota', description: 'Change quota policies and run evaluation.' },
  { key: 'quota.exempt',      category: PERMISSION_CATEGORIES.QUOTA, label: 'Exempt quota', description: 'Grant or revoke individual quota exemptions.' },

  // ---------- strikes ----------
  { key: 'strikes.view',      category: PERMISSION_CATEGORIES.STRIKES, label: 'View strikes', description: 'View strike history.' },
  { key: 'strikes.issue',     category: PERMISSION_CATEGORIES.STRIKES, label: 'Issue strikes', description: 'Issue manual strikes.' },
  { key: 'strikes.remove',    category: PERMISSION_CATEGORIES.STRIKES, label: 'Remove strikes', description: 'Cancel or recover strikes.' },
  { key: 'strikes.manage',    category: PERMISSION_CATEGORIES.STRIKES, label: 'Manage strikes', description: 'Full strike management.' },

  // ---------- leave ----------
  { key: 'leave.view',        category: PERMISSION_CATEGORIES.LEAVE, label: 'View leaves', description: 'View leave requests.' },
  { key: 'leave.create',      category: PERMISSION_CATEGORIES.LEAVE, label: 'Create leave', description: 'Submit a leave request for self.' },
  { key: 'leave.approve',     category: PERMISSION_CATEGORIES.LEAVE, label: 'Approve leaves', description: 'Approve leave requests.' },
  { key: 'leave.reject',      category: PERMISSION_CATEGORIES.LEAVE, label: 'Reject leaves', description: 'Reject leave requests.' },
  { key: 'leave.manage',      category: PERMISSION_CATEGORIES.LEAVE, label: 'Manage leaves', description: 'Full leave management.' },

  // ---------- notice ----------
  { key: 'notice.view',       category: PERMISSION_CATEGORIES.NOTICE, label: 'View notices', description: 'View notices.' },
  { key: 'notice.create',     category: PERMISSION_CATEGORIES.NOTICE, label: 'Create notices', description: 'Create notices.' },
  { key: 'notice.manage',     category: PERMISSION_CATEGORIES.NOTICE, label: 'Manage notices', description: 'Expire or cancel notices.' },

  // ---------- removal ----------
  { key: 'removal.view',      category: PERMISSION_CATEGORIES.REMOVAL, label: 'View removals', description: 'View pending removal requests.' },
  { key: 'removal.approve',   category: PERMISSION_CATEGORIES.REMOVAL, label: 'Approve removals', description: 'Approve pending removal requests.' },
  { key: 'removal.dismiss',   category: PERMISSION_CATEGORIES.REMOVAL, label: 'Dismiss removals', description: 'Dismiss pending removal requests.' },

  // ---------- reports ----------
  { key: 'reports.view',      category: PERMISSION_CATEGORIES.REPORTS, label: 'View reports', description: 'View stored reports.' },
  { key: 'reports.generate',  category: PERMISSION_CATEGORIES.REPORTS, label: 'Generate reports', description: 'Generate reports on demand.' },

  // ---------- statistics ----------
  { key: 'statistics.view',   category: PERMISSION_CATEGORIES.STATISTICS, label: 'View statistics', description: 'View aggregated statistics.' },

  // ---------- settings ----------
  { key: 'settings.view',     category: PERMISSION_CATEGORIES.SETTINGS, label: 'View settings', description: 'View current settings.' },
  { key: 'settings.manage',   category: PERMISSION_CATEGORIES.SETTINGS, label: 'Manage settings', description: 'Change settings.' },

  // ---------- audit ----------
  { key: 'audit.view',        category: PERMISSION_CATEGORIES.AUDIT, label: 'View audit logs', description: 'View the audit log.' },

  // ---------- roblox ----------
  { key: 'roblox.view',       category: PERMISSION_CATEGORIES.ROBLOX, label: 'View Roblox data', description: 'View Roblox sync results and rank info.' },
  { key: 'roblox.sync',       category: PERMISSION_CATEGORIES.ROBLOX, label: 'Run Roblox sync', description: 'Trigger manual Roblox group sync.' },
    // ---------- verification (account linking) ----------
  { key: 'verification.manualLink', category: PERMISSION_CATEGORIES.ROBLOX, label: 'Manually link accounts', description: 'Force-link a Discord user to a Roblox account, bypassing the verification code flow.' },
]);

/**
 * Wildcard definitions used by role seeds. Not written to the Permission
 * collection as standalone rows; the resolver expands them at runtime.
 * Listed here so seeds can reference them by constant.
 */
export const PERMISSION_WILDCARDS = Object.freeze({
  ALL: '*',
  USERS_ALL: 'users.*',
  ROLES_ALL: 'roles.*',
  EVENTS_ALL: 'events.*',
  ATTENDANCE_ALL: 'attendance.*',
  QUOTA_ALL: 'quota.*',
  STRIKES_ALL: 'strikes.*',
  LEAVE_ALL: 'leave.*',
  NOTICE_ALL: 'notice.*',
  REMOVAL_ALL: 'removal.*',
  REPORTS_ALL: 'reports.*',
  STATISTICS_ALL: 'statistics.*',
  SETTINGS_ALL: 'settings.*',
  AUDIT_ALL: 'audit.*',
  ROBLOX_ALL: 'roblox.*',
});

/** Flat array of every explicit permission key. */
export const ALL_PERMISSION_KEYS = Object.freeze(
  PERMISSIONS.map((p) => p.key)
);

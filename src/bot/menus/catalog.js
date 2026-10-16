// src/bot/menus/catalog.js

/**
 * Single source of truth for every menu-driven module.
 *
 * Adding a module = adding an entry here + a matching command file.
 * Adding an action = adding an item to `actions`.
 *
 * Action shape:
 *   key         Unique within the module. Used in customIds and handler lookup.
 *   label       Shown as the option label (max 100 chars).
 *   description Shown as the option description (max 100 chars).
 *   permission  Required permission, or null for "anyone".
 *   mode        'modal' | 'route' | 'direct'
 *   target      For 'modal': a key in MODAL_BUILDERS.
 *   module/fn   For 'route': the handler registry key (module + function name).
 *
 * No emojis in options — Discord renders them inconsistently and it looks
 * less professional. The module-level emoji goes in the embed title.
 */

export const CATALOG = Object.freeze({
  // ============================================================
  //  EVENTS
  // ============================================================
  event: {
    label: 'Events',
    emoji: '📅',
    description: 'Log events, review submissions, and manage event history.',
    actions: [
      {
        key: 'create',
        label: 'Create Event',
        description: 'Log a new event with proof and attendees.',
        permission: 'events.create',
        mode: 'modal',
        target: 'modal:event-create',
      },
      {
        key: 'view',
        label: 'View Event',
        description: 'Open a single event by selecting it from a list.',
        permission: 'events.view',
        mode: 'route',
        module: 'event',
        fn: 'view',
      },
      {
        key: 'list',
        label: 'List Events',
        description: 'Browse events with filters and pagination.',
        permission: 'events.view',
        mode: 'route',
        module: 'event',
        fn: 'list',
      },
      {
        key: 'approve',
        label: 'Approve Event',
        description: 'Approve a pending event and credit attendance.',
        permission: 'events.approve',
        mode: 'route',
        module: 'event',
        fn: 'approve',
      },
      {
        key: 'reject',
        label: 'Reject Event',
        description: 'Reject a pending event with a reason.',
        permission: 'events.reject',
        mode: 'route',
        module: 'event',
        fn: 'reject',
      },
      {
        key: 'cancel',
        label: 'Cancel Event',
        description: 'Cancel an approved event (reverses attendance).',
        permission: 'events.cancel',
        mode: 'route',
        module: 'event',
        fn: 'cancel',
      },
      {
        key: 'types',
        label: 'Event Types',
        description: 'Show available event types.',
        permission: 'events.view',
        mode: 'route',
        module: 'event',
        fn: 'types',
      },
      {
        key: 'stats',
        label: 'Event Stats',
        description: 'Event activity statistics with trend comparison.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'event',
        fn: 'stats',
      },
    ],
  },

  // ============================================================
  //  ATTENDANCE
  // ============================================================
  attendance: {
    label: 'Attendance',
    emoji: '🎟️',
    description: 'Attendance records and manual corrections.',
    actions: [
      {
        key: 'view',
        label: 'View Attendance',
        description: 'List attendance records for a user.',
        permission: 'attendance.view',
        mode: 'route',
        module: 'attendance',
        fn: 'view',
      },
      {
        key: 'history',
        label: 'Attendance History',
        description: 'Full attendance timeline, including removed records.',
        permission: 'attendance.view',
        mode: 'route',
        module: 'attendance',
        fn: 'history',
      },
      {
        key: 'stats',
        label: 'Attendance Stats',
        description: 'Aggregated attendance statistics.',
        permission: 'attendance.view',
        mode: 'route',
        module: 'attendance',
        fn: 'stats',
      },
      {
        key: 'add',
        label: 'Add Attendance',
        description: 'Manually add a user to an event.',
        permission: 'attendance.manage',
        mode: 'route',
        module: 'attendance',
        fn: 'add',
      },
      {
        key: 'remove',
        label: 'Remove Attendance',
        description: 'Manually remove a user from an event.',
        permission: 'attendance.manage',
        mode: 'route',
        module: 'attendance',
        fn: 'remove',
      },
    ],
  },

  // ============================================================
  //  QUOTA
  // ============================================================
  quota: {
    label: 'Quotas',
    emoji: '📊',
    description: 'Weekly quota policies, exemptions, and status.',
    actions: [
      {
        key: 'view',
        label: 'View Policies',
        description: 'Show the active quota policy for each category.',
        permission: 'quota.view',
        mode: 'route',
        module: 'quota',
        fn: 'view',
      },
      {
        key: 'status',
        label: 'Period Status',
        description: 'Show the current quota period and policy snapshot.',
        permission: 'quota.view',
        mode: 'route',
        module: 'quota',
        fn: 'status',
      },
      {
        key: 'history',
        label: 'Quota History',
        description: 'Recent weekly quota results for a user.',
        permission: 'quota.view',
        mode: 'route',
        module: 'quota',
        fn: 'history',
      },
      {
        key: 'set',
        label: 'Set Policy',
        description: 'Change the quota policy for a category.',
        permission: 'quota.manage',
        mode: 'modal',
        target: 'modal:quota-set',
      },
      {
        key: 'exempt',
        label: 'Grant Exemption',
        description: 'Exempt a user from weekly quota.',
        permission: 'quota.exempt',
        mode: 'route',
        module: 'quota',
        fn: 'exempt',
      },
      {
        key: 'unexempt',
        label: 'Revoke Exemption',
        description: 'Remove a user\u2019s weekly quota exemption.',
        permission: 'quota.exempt',
        mode: 'route',
        module: 'quota',
        fn: 'unexempt',
      },
    ],
  },

  // ============================================================
  //  STRIKES
  // ============================================================
  strike: {
    label: 'Strikes',
    emoji: '⚠️',
    description: 'Strike management, recovery, and removal requests.',
    actions: [
      {
        key: 'view',
        label: 'View Strikes',
        description: 'Show active strikes for a user.',
        permission: 'strikes.view',
        mode: 'route',
        module: 'strike',
        fn: 'view',
      },
      {
        key: 'history',
        label: 'Strike History',
        description: 'Full strike history for a user.',
        permission: 'strikes.view',
        mode: 'route',
        module: 'strike',
        fn: 'history',
      },
      {
        key: 'issue',
        label: 'Issue Strike',
        description: 'Issue a manual strike to a user.',
        permission: 'strikes.issue',
        mode: 'route',
        module: 'strike',
        fn: 'issue',
      },
      {
        key: 'remove',
        label: 'Remove Strike',
        description: 'Remove an active strike from a user.',
        permission: 'strikes.remove',
        mode: 'route',
        module: 'strike',
        fn: 'remove',
      },
      {
        key: 'recover',
        label: 'Recover Strike',
        description: 'Mark an active strike as recovered.',
        permission: 'strikes.remove',
        mode: 'route',
        module: 'strike',
        fn: 'recover',
      },
      {
        key: 'pending-removals',
        label: 'Pending Removals',
        description: 'List pending removal requests.',
        permission: 'removal.view',
        mode: 'route',
        module: 'strike',
        fn: 'pending-removals',
      },
      {
        key: 'approve-removal',
        label: 'Approve Removal',
        description: 'Approve a pending removal request.',
        permission: 'removal.approve',
        mode: 'route',
        module: 'strike',
        fn: 'approve-removal',
      },
      {
        key: 'dismiss-removal',
        label: 'Dismiss Removal',
        description: 'Dismiss a pending removal request.',
        permission: 'removal.dismiss',
        mode: 'route',
        module: 'strike',
        fn: 'dismiss-removal',
      },
    ],
  },

  // ============================================================
  //  LEAVE
  // ============================================================
  leave: {
    label: 'Leave',
    emoji: '🌴',
    description: 'Leave requests and approvals.',
    actions: [
      {
        key: 'create',
        label: 'Request Leave',
        description: 'Submit a new leave request.',
        permission: 'leave.create',
        mode: 'modal',
        target: 'modal:leave-create',
      },
      {
        key: 'view',
        label: 'View Leave History',
        description: 'View leave history for a user.',
        permission: 'leave.view',
        mode: 'route',
        module: 'leave',
        fn: 'view',
      },
      {
        key: 'active',
        label: 'Active Leaves',
        description: 'List currently active approved leaves.',
        permission: 'leave.view',
        mode: 'route',
        module: 'leave',
        fn: 'active',
      },
      {
        key: 'approve',
        label: 'Approve Leave',
        description: 'Approve a pending leave request.',
        permission: 'leave.approve',
        mode: 'route',
        module: 'leave',
        fn: 'approve',
      },
      {
        key: 'reject',
        label: 'Reject Leave',
        description: 'Reject a pending leave request.',
        permission: 'leave.reject',
        mode: 'route',
        module: 'leave',
        fn: 'reject',
      },
      {
        key: 'end',
        label: 'End Leave',
        description: 'End an approved leave early.',
        permission: 'leave.manage',
        mode: 'route',
        module: 'leave',
        fn: 'end',
      },
      {
        key: 'cancel',
        label: 'Cancel My Leave',
        description: 'Cancel your own pending leave request.',
        permission: 'leave.create',
        mode: 'route',
        module: 'leave',
        fn: 'cancel',
      },
    ],
  },

  // ============================================================
  //  NOTICES
  // ============================================================
  notice: {
    label: 'Notices',
    emoji: '📌',
    description: 'Notices and inactivity records.',
    actions: [
      {
        key: 'create',
        label: 'Create Notice',
        description: 'Create a notice for a user.',
        permission: 'notice.create',
        mode: 'route',
        module: 'notice',
        fn: 'create',
      },
      {
        key: 'view',
        label: 'View Notices',
        description: 'View active notices for a user.',
        permission: 'notice.view',
        mode: 'route',
        module: 'notice',
        fn: 'view',
      },
      {
        key: 'cancel',
        label: 'Cancel Notice',
        description: 'Cancel an active notice.',
        permission: 'notice.manage',
        mode: 'route',
        module: 'notice',
        fn: 'cancel',
      },
      {
        key: 'active',
        label: 'Active Notices',
        description: 'List all active notices.',
        permission: 'notice.view',
        mode: 'route',
        module: 'notice',
        fn: 'active',
      },
      {
        key: 'extend',
        label: 'Request Extension',
        description: 'Request an extension for your own active notice.',
        permission: 'notice.view',
        mode: 'route',
        module: 'notice',
        fn: 'extend',
      },
      {
        key: 'approve-extension',
        label: 'Approve Extension',
        description: 'Approve a pending notice extension.',
        permission: 'notice.manage',
        mode: 'route',
        module: 'notice',
        fn: 'approve-extension',
      },
      {
        key: 'reject-extension',
        label: 'Reject Extension',
        description: 'Reject a pending notice extension.',
        permission: 'notice.manage',
        mode: 'route',
        module: 'notice',
        fn: 'reject-extension',
      },
    ],
  },

  // ============================================================
  //  ROLES
  // ============================================================
  roles: {
    label: 'Roles',
    emoji: '🎖️',
    description: 'Internal role management.',
    actions: [
      {
        key: 'list',
        label: 'List Roles',
        description: 'List all active roles.',
        permission: 'roles.view',
        mode: 'route',
        module: 'roles',
        fn: 'list',
      },
      {
        key: 'view',
        label: 'View Role',
        description: 'View a role in detail.',
        permission: 'roles.view',
        mode: 'route',
        module: 'roles',
        fn: 'view',
      },
      {
        key: 'create',
        label: 'Create Role',
        description: 'Create a new custom role.',
        permission: 'roles.create',
        mode: 'modal',
        target: 'modal:role-create',
      },
      {
        key: 'edit',
        label: 'Edit Role',
        description: 'Edit an existing role.',
        permission: 'roles.edit',
        mode: 'route',
        module: 'roles',
        fn: 'edit',
      },
      {
        key: 'delete',
        label: 'Delete Role',
        description: 'Delete a custom role.',
        permission: 'roles.delete',
        mode: 'route',
        module: 'roles',
        fn: 'delete',
      },
      {
        key: 'assign',
        label: 'Assign Role',
        description: 'Assign a role to a user.',
        permission: 'roles.assign',
        mode: 'route',
        module: 'roles',
        fn: 'assign',
      },
      {
        key: 'remove',
        label: 'Remove Role',
        description: 'Remove a role from a user.',
        permission: 'roles.assign',
        mode: 'route',
        module: 'roles',
        fn: 'remove',
      },
      {
        key: 'permissions',
        label: 'Role Permissions',
        description: 'List the effective permissions of a role.',
        permission: 'roles.view',
        mode: 'route',
        module: 'roles',
        fn: 'permissions',
      },
    ],
  },

  // ============================================================
  //  MEMBERS
  // ============================================================
  members: {
    label: 'Members',
    emoji: '👥',
    description: 'Browse and filter group members.',
    actions: [
      {
        key: 'view',
        label: 'View Member',
        description: 'Show a full profile card for a member.',
        permission: 'users.view',
        mode: 'route',
        module: 'members',
        fn: 'view',
      },
      {
        key: 'list',
        label: 'List Members',
        description: 'List members with optional filters.',
        permission: 'users.view',
        mode: 'route',
        module: 'members',
        fn: 'list',
      },
      {
        key: 'active',
        label: 'Active Members',
        description: 'List active members.',
        permission: 'users.view',
        mode: 'route',
        module: 'members',
        fn: 'active',
      },
      {
        key: 'inactive',
        label: 'Inactive Members',
        description: 'List inactive or left members.',
        permission: 'users.view',
        mode: 'route',
        module: 'members',
        fn: 'inactive',
      },
      {
        key: 'leave',
        label: 'Members on Leave',
        description: 'List members currently on approved leave.',
        permission: 'users.view',
        mode: 'route',
        module: 'members',
        fn: 'leave',
      },
      {
        key: 'pending-removal',
        label: 'Pending Removals',
        description: 'List members with pending removal requests.',
        permission: 'users.view',
        mode: 'route',
        module: 'members',
        fn: 'pending-removal',
      },
      {
        key: 'rank',
        label: 'By Roblox Rank',
        description: 'List members filtered by Roblox rank.',
        permission: 'users.view',
        mode: 'route',
        module: 'members',
        fn: 'rank',
      },
      {
        key: 'role',
        label: 'By Internal Role',
        description: 'List members filtered by internal role.',
        permission: 'users.view',
        mode: 'route',
        module: 'members',
        fn: 'role',
      },
    ],
  },

  // ============================================================
  //  STATISTICS
  // ============================================================
  stats: {
    label: 'Statistics',
    emoji: '📈',
    description: 'Group analytics and dashboards.',
    actions: [
      {
        key: 'daily',
        label: 'Daily Summary',
        description: 'Activity summary for today.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'stats',
        fn: 'daily',
      },
      {
        key: 'weekly',
        label: 'Weekly Summary',
        description: 'Activity summary for the current ISO week.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'stats',
        fn: 'weekly',
      },
      {
        key: 'monthly',
        label: 'Monthly Summary',
        description: 'Activity summary for the current calendar month.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'stats',
        fn: 'monthly',
      },
      {
        key: 'user',
        label: 'User Dashboard',
        description: 'Per-user activity, strikes, roles, and quota.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'stats',
        fn: 'user',
      },
      {
        key: 'events',
        label: 'Event Stats',
        description: 'All-time event statistics.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'stats',
        fn: 'events',
      },
      {
        key: 'attendance',
        label: 'Attendance Stats',
        description: 'All-time attendance statistics.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'stats',
        fn: 'attendance',
      },
      {
        key: 'hosts',
        label: 'Top Hosts',
        description: 'Top event hosts, all time.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'stats',
        fn: 'hosts',
      },
      {
        key: 'attendees',
        label: 'Top Attendees',
        description: 'Top attendees leaderboard.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'stats',
        fn: 'attendees',
      },
      {
        key: 'quota',
        label: 'Quota Stats',
        description: 'Quota completion statistics.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'stats',
        fn: 'quota',
      },
      {
        key: 'strikes',
        label: 'Strike Stats',
        description: 'Strike statistics and top users.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'stats',
        fn: 'strikes',
      },
      {
        key: 'members',
        label: 'Member Breakdown',
        description: 'Member counts by status, role, and rank.',
        permission: 'statistics.view',
        mode: 'route',
        module: 'stats',
        fn: 'members',
      },
    ],
  },

  // ============================================================
  //  REPORTS
  // ============================================================
  report: {
    label: 'Reports',
    emoji: '📄',
    description: 'Weekly, monthly, and manual reports.',
    actions: [
      {
        key: 'weekly',
        label: 'Weekly Report',
        description: 'Generate this week\u2019s report.',
        permission: 'reports.generate',
        mode: 'route',
        module: 'report',
        fn: 'weekly',
      },
      {
        key: 'monthly',
        label: 'Monthly Report',
        description: 'Generate this month\u2019s report.',
        permission: 'reports.generate',
        mode: 'route',
        module: 'report',
        fn: 'monthly',
      },
      {
        key: 'generate',
        label: 'Manual Report',
        description: 'Generate a report for a custom date range.',
        permission: 'reports.generate',
        mode: 'modal',
        target: 'modal:report-generate',
      },
      {
        key: 'list',
        label: 'List Reports',
        description: 'List stored reports.',
        permission: 'reports.view',
        mode: 'route',
        module: 'report',
        fn: 'list',
      },
      {
        key: 'view',
        label: 'View Report',
        description: 'View a stored report.',
        permission: 'reports.view',
        mode: 'route',
        module: 'report',
        fn: 'view',
      },
    ],
  },

  // ============================================================
  //  SETTINGS
  // ============================================================
  settings: {
    label: 'Settings',
    emoji: '⚙️',
    description: 'View and edit bot settings.',
    actions: [
      {
        key: 'view',
        label: 'View Settings',
        description: 'View all current settings.',
        permission: 'settings.view',
        mode: 'route',
        module: 'settings',
        fn: 'view',
      },
      {
        key: 'paths',
        label: 'List Paths',
        description: 'List every writable setting path.',
        permission: 'settings.view',
        mode: 'route',
        module: 'settings',
        fn: 'paths',
      },
      {
        key: 'set',
        label: 'Change Setting',
        description: 'Change a setting\u2019s value.',
        permission: 'settings.manage',
        mode: 'route',
        module: 'settings',
        fn: 'set',
      },
      {
        key: 'reset',
        label: 'Reset Setting',
        description: 'Reset a setting to its default.',
        permission: 'settings.manage',
        mode: 'route',
        module: 'settings',
        fn: 'reset',
      },
    ],
  },

  // ============================================================
  //  AUDIT
  // ============================================================
  audit: {
    label: 'Audit',
    emoji: '📜',
    description: 'Browse the audit log.',
    actions: [
      {
        key: 'view',
        label: 'View Entries',
        description: 'Browse audit log entries with filters.',
        permission: 'audit.view',
        mode: 'route',
        module: 'audit',
        fn: 'view',
      },
      {
        key: 'summary',
        label: 'Summary',
        description: 'Aggregated audit log summary.',
        permission: 'audit.view',
        mode: 'route',
        module: 'audit',
        fn: 'summary',
      },
      {
        key: 'entry',
        label: 'View Entry',
        description: 'View a single audit log entry by ID.',
        permission: 'audit.view',
        mode: 'route',
        module: 'audit',
        fn: 'entry',
      },
    ],
  },
});

/**
 * Return an action by module key + action key.
 */
export function getAction(moduleKey, actionKey) {
  return CATALOG[moduleKey]?.actions.find((a) => a.key === actionKey) ?? null;
}

/**
 * Return the module definition by key.
 */
export function getModule(moduleKey) {
  return CATALOG[moduleKey] ?? null;
}
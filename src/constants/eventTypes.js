/**
 * Seeded event types. The DB remains the source of truth —
 * High Command may add/disable types via /settings in a later phase.
 * Seeding is idempotent: existing rows are not modified (only missing
 * keys are inserted), so admins can safely edit names without having
 * their changes overwritten on the next deploy.
 */
export const EVENT_TYPE_SEEDS = Object.freeze([
  { key: 'patrol', name: 'Patrol', sortOrder: 10, description: 'Standard patrol.' },
  { key: 'ct',     name: 'CT',     sortOrder: 20, description: 'Combat training.' },
  { key: 'dt',     name: 'DT',     sortOrder: 30, description: 'Defensive training.' },
  { key: 'raid',   name: 'Raid',   sortOrder: 40, description: 'Raid operation.' },
  { key: 'tryout', name: 'Tryout', sortOrder: 50, description: 'Recruitment tryout.' },
  { key: 'other',  name: 'Other',  sortOrder: 99, description: 'Any other official event.' },
]);
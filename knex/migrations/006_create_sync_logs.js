/**
 * sync_logs — records each Roblox group synchronization run.
 *
 * "One RUNNING sync per type" is enforced at the service layer via
 * atomic insert-if-not-exists.
 *
 * captured_errors is a JSON column with no default — the app always
 * supplies it (typically an empty array).
 */
export async function up(knex) {
  await knex.schema.createTable('sync_logs', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table
      .enu('type', ['ROBLOX_GROUP_SYNC'], {
        useNative: true,
        enumName: 'sync_logs_type_enum',
      })
      .notNullable()
      .defaultTo('ROBLOX_GROUP_SYNC');

    table.string('triggered_by', 32).notNullable().defaultTo('system');
    table.dateTime('started_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('completed_at').nullable();

    table
      .enu('status', ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'], {
        useNative: true,
        enumName: 'sync_logs_status_enum',
      })
      .notNullable()
      .defaultTo('RUNNING');

    table.integer('members_fetched').unsigned().notNullable().defaultTo(0);
    table.integer('members_created').unsigned().notNullable().defaultTo(0);
    table.integer('members_updated').unsigned().notNullable().defaultTo(0);
    table.integer('rank_changes').unsigned().notNullable().defaultTo(0);
    table.integer('members_removed').unsigned().notNullable().defaultTo(0);

    table.json('captured_errors').notNullable();
    table.string('summary', 500).nullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['type', 'started_at'], 'idx_sync_logs_type_started_desc');
    table.index(['type', 'status'], 'idx_sync_logs_type_status');
  });

  await knex.raw(
    'ALTER TABLE `sync_logs` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('sync_logs');
}
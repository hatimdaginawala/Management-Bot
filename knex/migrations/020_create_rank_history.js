/**
 * rank_history — append-only record of every Roblox rank change.
 *
 * Both old and new rank snapshots are required (even if the old rank
 * was "not in group", the snapshot exists so we can represent joins
 * and departures cleanly).
 *
 * `sync_log_id` references the SyncLog that observed the change.
 */
export async function up(knex) {
  await knex.schema.createTable('rank_history', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.bigInteger('user_id').unsigned().notNullable();
    table.string('discord_id', 32).notNullable();
    table.string('roblox_id', 32).notNullable();

    // Old rank snapshot
    table.integer('old_rank_id').nullable();
    table.string('old_rank_name', 64).nullable();
    table.integer('old_rank_value').nullable();

    // New rank snapshot
    table.integer('new_rank_id').nullable();
    table.string('new_rank_name', 64).nullable();
    table.integer('new_rank_value').nullable();

    table.dateTime('changed_at').notNullable().defaultTo(knex.fn.now());

    table
      .enu('source', ['SYNC', 'MANUAL', 'IMPORT'], {
        useNative: true,
        enumName: 'rank_history_source_enum',
      })
      .notNullable()
      .defaultTo('SYNC');

    table.bigInteger('sync_log_id').unsigned().nullable();

    table.string('note', 500).nullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['user_id', 'changed_at'], 'idx_rank_history_user_changed_at_desc');
    table.index(['sync_log_id'], 'idx_rank_history_sync_log_id');

    table
      .foreign('user_id', 'fk_rank_history_user')
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');

    table
      .foreign('sync_log_id', 'fk_rank_history_sync_log')
      .references('id')
      .inTable('sync_logs')
      .onDelete('SET NULL')
      .onUpdate('CASCADE');
  });

  await knex.raw(
    'ALTER TABLE `rank_history` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('rank_history');
}
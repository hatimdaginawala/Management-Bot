/**
 * quota_periods — weekly buckets for quota evaluation.
 *
 * `period_key` is a deterministic ISO week key (e.g. "2026-W41").
 * The status field acts as a lock: OPEN → CLOSING → CLOSED.
 */
export async function up(knex) {
  await knex.schema.createTable('quota_periods', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.string('period_key', 16).notNullable();
    table.dateTime('start_at').notNullable();
    table.dateTime('end_at').notNullable();

    table
      .enu('status', ['OPEN', 'CLOSING', 'CLOSED'], {
        useNative: true,
        enumName: 'quota_periods_status_enum',
      })
      .notNullable()
      .defaultTo('OPEN');

    table.dateTime('closed_at').nullable();
    table.integer('evaluated_count').unsigned().notNullable().defaultTo(0);
    table.integer('strikes_issued_count').unsigned().notNullable().defaultTo(0);
    table.integer('recoveries_applied_count').unsigned().notNullable().defaultTo(0);

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.unique(['period_key'], { indexName: 'uniq_quota_periods_period_key' });
    table.index(['status', 'start_at'], 'idx_quota_periods_status_start_desc');
  });

  await knex.raw(
    'ALTER TABLE `quota_periods` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('quota_periods');
}
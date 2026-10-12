/**
 * quota_results — per-user-per-period evaluation result.
 *
 * This is the idempotency anchor for weekly quota processing: the unique
 * (user_id, period_id, category) constraint guarantees the evaluation
 * job can safely be re-run without duplicating rows or strikes.
 *
 * exempt_reason now includes NOTICE (fixes the earlier gap where
 * notice-based exemptions weren't being recorded).
 */
export async function up(knex) {
  await knex.schema.createTable('quota_results', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.bigInteger('period_id').unsigned().notNullable();
    table.string('period_key', 16).notNullable();

    table.bigInteger('user_id').unsigned().notNullable();
    table.string('discord_id', 32).notNullable();

    table
      .enu('category', ['STAFF', 'LOW_RANK'], {
        useNative: true,
        enumName: 'quota_results_category_enum',
      })
      .notNullable();

    table
      .enu('metric', ['HOSTED_EVENTS', 'ATTENDED_EVENTS'], {
        useNative: true,
        enumName: 'quota_results_metric_enum',
      })
      .notNullable();

    table.integer('required_amount').notNullable();
    table.integer('actual_amount').notNullable().defaultTo(0);

    table
      .enu('status', ['MET', 'MISSED', 'EXEMPT', 'SKIPPED'], {
        useNative: true,
        enumName: 'quota_results_status_enum',
      })
      .notNullable();

    table
      .enu('exempt_reason', ['LEAVE', 'MANUAL', 'NOTICE'], {
        useNative: true,
        enumName: 'quota_results_exempt_reason_enum',
      })
      .nullable();

    table.boolean('strike_issued').notNullable().defaultTo(false);
    table.boolean('recovery_applied').notNullable().defaultTo(false);
    table.integer('recoveries_count').unsigned().notNullable().defaultTo(0);

    table.dateTime('evaluated_at').notNullable().defaultTo(knex.fn.now());

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.unique(['user_id', 'period_id', 'category'], {
      indexName: 'uniq_quota_results_user_period_category',
    });
    table.index(['period_id', 'status'], 'idx_quota_results_period_status');

    table
      .foreign('period_id', 'fk_quota_results_period')
      .references('id')
      .inTable('quota_periods')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');

    table
      .foreign('user_id', 'fk_quota_results_user')
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
  });

  await knex.raw(
    'ALTER TABLE `quota_results` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('quota_results');
}
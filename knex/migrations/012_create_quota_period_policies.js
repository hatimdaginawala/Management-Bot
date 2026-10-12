/**
 * quota_period_policies — immutable snapshot of policies in force when a
 * quota period was opened.
 *
 * This is the anchor for ".txt §21" (changing quota next week must not
 * rewrite historical results). Evaluation reads the snapshot, not the
 * current policy rows.
 */
export async function up(knex) {
  await knex.schema.createTable('quota_period_policies', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.bigInteger('quota_period_id').unsigned().notNullable();
    table.bigInteger('policy_id').unsigned().notNullable();

    table
      .enu('category', ['STAFF', 'LOW_RANK'], {
        useNative: true,
        enumName: 'quota_period_policies_category_enum',
      })
      .notNullable();

    table
      .enu('metric', ['HOSTED_EVENTS', 'ATTENDED_EVENTS'], {
        useNative: true,
        enumName: 'quota_period_policies_metric_enum',
      })
      .notNullable();

    table.integer('amount').notNullable();
    table.integer('recovery_multiplier').notNullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['quota_period_id', 'category'], {
      indexName: 'uniq_quota_period_policies',
    });

    table
      .foreign('quota_period_id', 'fk_quota_period_policies_period')
      .references('id')
      .inTable('quota_periods')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');

    table
      .foreign('policy_id', 'fk_quota_period_policies_policy')
      .references('id')
      .inTable('quota_policies')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
  });

  await knex.raw(
    'ALTER TABLE `quota_period_policies` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('quota_period_policies');
}
/**
 * quota_policies — versioned quota definitions.
 *
 * "One open policy per category" is enforced at the service layer
 * via a transaction that closes the previous policy and inserts the
 * new one atomically.
 */
export async function up(knex) {
  await knex.schema.createTable('quota_policies', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table
      .enu('category', ['STAFF', 'LOW_RANK'], {
        useNative: true,
        enumName: 'quota_policies_category_enum',
      })
      .notNullable();

    table
      .enu('metric', ['HOSTED_EVENTS', 'ATTENDED_EVENTS'], {
        useNative: true,
        enumName: 'quota_policies_metric_enum',
      })
      .notNullable();

    table.integer('amount').notNullable();

    table
      .enu('period_kind', ['WEEKLY'], {
        useNative: true,
        enumName: 'quota_policies_period_kind_enum',
      })
      .notNullable()
      .defaultTo('WEEKLY');

    table.dateTime('effective_from').notNullable();
    table.dateTime('effective_to').nullable();
    table.boolean('active').notNullable().defaultTo(true);

    table.integer('recovery_multiplier').notNullable().defaultTo(2);

    table.string('created_by', 32).notNullable().defaultTo('system');
    table.text('notes').nullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.index(['category', 'effective_from'], 'idx_quota_policies_category_effective_from');
    table.index(['category', 'active', 'effective_to'], 'idx_quota_policies_open');
  });

  await knex.raw(
    'ALTER TABLE `quota_policies` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('quota_policies');
}
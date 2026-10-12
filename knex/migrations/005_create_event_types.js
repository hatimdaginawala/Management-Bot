/**
 * event_types — configurable event type catalog.
 * Seeded at install; may be extended by admins.
 */
export async function up(knex) {
  await knex.schema.createTable('event_types', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.string('key', 32).notNullable();
    table.string('name', 64).notNullable();
    table.string('description', 500).notNullable().defaultTo('');
    table.boolean('counts_for_quota').notNullable().defaultTo(true);
    table.boolean('active').notNullable().defaultTo(true);
    table.integer('sort_order').notNullable().defaultTo(0);
    table.string('created_by', 32).notNullable().defaultTo('system');
    table.boolean('is_deletable').notNullable().defaultTo(true);

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.unique(['key'], { indexName: 'uniq_event_types_key' });
    table.index(['active'], 'idx_event_types_active');
  });

  await knex.raw(
    'ALTER TABLE `event_types` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('event_types');
}
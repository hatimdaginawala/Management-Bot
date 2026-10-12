/**
 * permissions — catalog of available permission keys.
 * Seeded at install; extended as code adds new permission strings.
 */
export async function up(knex) {
  await knex.schema.createTable('permissions', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.string('key', 96).notNullable();
    table.string('label', 255).notNullable();
    table.string('description', 500).notNullable().defaultTo('');
    table.string('category', 32).notNullable();
    table.boolean('is_wildcard').notNullable().defaultTo(false);

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.unique(['key'], { indexName: 'uniq_permissions_key' });
    table.index(['category'], 'idx_permissions_category');
  });

  await knex.raw(
    'ALTER TABLE `permissions` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('permissions');
}
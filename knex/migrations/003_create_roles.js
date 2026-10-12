/**
 * roles — dynamic internal roles.
 *
 * `permissions` is a JSON array of permission keys (or wildcards).
 * `quota_category` tags the role as contributing to quota evaluation.
 */
export async function up(knex) {
  await knex.schema.createTable('roles', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.string('key', 64).notNullable();
    table.string('name', 80).notNullable();
    table.string('description', 500).notNullable().defaultTo('');

    table.json('permissions').notNullable();
    table.integer('priority').notNullable().defaultTo(0);

    table
      .enu('quota_category', ['NONE', 'STAFF', 'LOW_RANK'], {
        useNative: true,
        enumName: 'roles_quota_category_enum',
      })
      .notNullable()
      .defaultTo('NONE');

    table
      .enu('kind', ['SYSTEM', 'CUSTOM'], {
        useNative: true,
        enumName: 'roles_kind_enum',
      })
      .notNullable()
      .defaultTo('CUSTOM');

    table.boolean('is_permanent').notNullable().defaultTo(false);
    table.boolean('is_editable').notNullable().defaultTo(true);
    table.boolean('is_deletable').notNullable().defaultTo(true);
    table.boolean('active').notNullable().defaultTo(true);

    table.string('created_by', 32).notNullable().defaultTo('system');

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.unique(['key'], { indexName: 'uniq_roles_key' });
    table.index(['priority'], 'idx_roles_priority');
    table.index(['quota_category'], 'idx_roles_quota_category');
    table.index(['kind'], 'idx_roles_kind');
    table.index(['active'], 'idx_roles_active');
  });

  await knex.raw(
    'ALTER TABLE `roles` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('roles');
}
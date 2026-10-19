/**
 * settings — key-value rows for all bot configuration.
 *
 * In MongoDB, Settings was a single nested document. In MySQL, we
 * flatten to one row per setting path so that setSetting(path, value)
 * is a simple update and all paths have explicit types.
 *
 * value_type tracks the JS type so the app can coerce values back
 * correctly on read. value_json stores the JSON-serialized value.
 */
export async function up(knex) {
  await knex.schema.createTable('settings', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.string('setting_key', 96).notNullable();
    table.string('setting_group', 32).notNullable();

    // Type tag: 'string' | 'number' | 'boolean' | 'null' | 'json'
    table
      .enu('value_type', ['string', 'number', 'boolean', 'null', 'json'], {
        useNative: true,
        enumName: 'settings_value_type_enum',
      })
      .notNullable();

    // JSON-serialized value. For simple types this is still valid JSON:
    //   string  -> "hello"
    //   number  -> 5
    //   boolean -> true
    //   null    -> null
    //   json    -> {"a":1}
    table.text('value_json').notNullable();

    table.string('description', 255).nullable();

    table.string('last_updated_by', 32).notNullable().defaultTo('system');
    table.dateTime('last_updated_at').notNullable().defaultTo(knex.fn.now());

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.unique(['setting_key'], { indexName: 'uniq_settings_setting_key' });
    table.index(['setting_group'], 'idx_settings_setting_group');
  });

  await knex.raw(
    'ALTER TABLE `settings` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('settings');
}
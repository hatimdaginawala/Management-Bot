/**
 * audit_logs — append-only administrative history.
 *
 * Never updated, never deleted (except by extreme, documented cleanup).
 * `before`, `after`, and `context` are JSON columns because they hold
 * arbitrary shapes depending on the action.
 *
 * Actor is a Discord ID or "system".
 */
export async function up(knex) {
  await knex.schema.createTable('audit_logs', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.string('actor_id', 32).notNullable();
    table.string('action', 96).notNullable();

    table
      .enu(
        'category',
        [
          'USER',
          'ROLE',
          'EVENT',
          'ATTENDANCE',
          'QUOTA',
          'STRIKE',
          'LEAVE',
          'NOTICE',
          'REMOVAL',
          'SETTINGS',
          'SYNC',
          'REPORT',
        ],
        {
          useNative: true,
          enumName: 'audit_logs_category_enum',
        }
      )
      .notNullable();

    table.string('target_type', 64).notNullable();
    table.string('target_id', 64).nullable();

    table.json('before_json').nullable();
    table.json('after_json').nullable();
    table.json('context_json').nullable();

    table.string('reason', 500).nullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['actor_id', 'created_at'], 'idx_audit_logs_actor_created_desc');
    table.index(['category', 'created_at'], 'idx_audit_logs_category_created_desc');
    table.index(['target_type', 'target_id', 'created_at'], 'idx_audit_logs_target_created_desc');
  });

  await knex.raw(
    'ALTER TABLE `audit_logs` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('audit_logs');
}
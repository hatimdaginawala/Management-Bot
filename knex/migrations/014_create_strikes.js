/**
 * strikes — strike records with recovery.
 *
 * "One QUOTA_MISSED strike per (user, period)" is enforced at the
 * service layer via INSERT ... WHERE NOT EXISTS, because MySQL
 * disallows the generated-column + foreign-key combination.
 */
export async function up(knex) {
  await knex.schema.createTable('strikes', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.bigInteger('user_id').unsigned().notNullable();
    table.string('discord_id', 32).notNullable();

    table
      .enu('type', ['QUOTA_MISSED', 'MANUAL'], {
        useNative: true,
        enumName: 'strikes_type_enum',
      })
      .notNullable();

    table.string('quota_period_key', 16).nullable();
    table.text('reason').notNullable();
    table.string('issued_by', 32).notNullable().defaultTo('system');
    table.dateTime('issued_at').notNullable().defaultTo(knex.fn.now());

    table
      .enu('status', ['ACTIVE', 'RECOVERED', 'CANCELLED', 'EXPIRED'], {
        useNative: true,
        enumName: 'strikes_status_enum',
      })
      .notNullable()
      .defaultTo('ACTIVE');

    table.dateTime('resolved_at').nullable();
    table.string('resolved_by', 32).nullable();
    table.string('resolution_reason', 500).nullable();
    table.string('recovered_in_period_key', 16).nullable();

    table.text('notes').nullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.index(['user_id', 'status'], 'idx_strikes_user_status');
    table.index(['discord_id'], 'idx_strikes_discord_id');
    table.index(['quota_period_key'], 'idx_strikes_quota_period_key');
    table.index(['user_id', 'type', 'quota_period_key'], 'idx_strikes_user_type_period');

    table
      .foreign('user_id', 'fk_strikes_user')
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
  });

  await knex.raw(
    'ALTER TABLE `strikes` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('strikes');
}
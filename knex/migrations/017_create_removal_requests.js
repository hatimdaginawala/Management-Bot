/**
 * removal_requests — pending removal requests.
 *
 * "One PENDING removal request per user" is enforced at the service
 * layer via INSERT ... WHERE NOT EXISTS, because MySQL disallows the
 * generated-column + foreign-key combination on the same column.
 */
export async function up(knex) {
  await knex.schema.createTable('removal_requests', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.bigInteger('user_id').unsigned().notNullable();
    table.string('discord_id', 32).notNullable();

    table
      .enu('reason', ['THRESHOLD', 'MANUAL'], {
        useNative: true,
        enumName: 'removal_requests_reason_enum',
      })
      .notNullable();

    table.integer('strike_count').notNullable();
    table.integer('strike_threshold').notNullable();

    table.text('description').nullable();

    table
      .enu('status', ['PENDING', 'APPROVED', 'DISMISSED', 'CANCELLED'], {
        useNative: true,
        enumName: 'removal_requests_status_enum',
      })
      .notNullable()
      .defaultTo('PENDING');

    table.string('reviewed_by', 32).nullable();
    table.dateTime('reviewed_at').nullable();
    table.string('review_reason', 500).nullable();

    table.dateTime('removal_effective_at').nullable();
    table.dateTime('applied_at').nullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.index(['status', 'removal_effective_at'], 'idx_removal_requests_status_effective_at');
    table.index(['user_id', 'status'], 'idx_removal_requests_user_status');
    table.index(['discord_id'], 'idx_removal_requests_discord_id');

    table
      .foreign('user_id', 'fk_removal_requests_user')
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
  });

  await knex.raw(
    'ALTER TABLE `removal_requests` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('removal_requests');
}
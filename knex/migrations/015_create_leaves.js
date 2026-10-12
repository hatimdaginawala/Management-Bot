/**
 * leaves — leave requests and approvals.
 *
 * "One PENDING leave per user" and "one APPROVED leave per user" are
 * enforced at the service layer via INSERT ... WHERE NOT EXISTS,
 * because MySQL disallows the generated-column + foreign-key
 * combination on the same column.
 */
export async function up(knex) {
  await knex.schema.createTable('leaves', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.bigInteger('user_id').unsigned().notNullable();
    table.string('discord_id', 32).notNullable();

    table.dateTime('start_at').notNullable();
    table.dateTime('end_at').notNullable();

    table.text('reason').notNullable();

    table
      .enu('status', ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'], {
        useNative: true,
        enumName: 'leaves_status_enum',
      })
      .notNullable()
      .defaultTo('PENDING');

    table.string('reviewed_by', 32).nullable();
    table.dateTime('reviewed_at').nullable();
    table.string('review_reason', 500).nullable();

    table.dateTime('expired_at').nullable();

    table.text('notes').nullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.index(['user_id', 'status'], 'idx_leaves_user_status');
    table.index(['discord_id'], 'idx_leaves_discord_id');
    table.index(['status', 'start_at', 'end_at'], 'idx_leaves_status_range');
    table.index(['status', 'end_at'], 'idx_leaves_status_end_at');

    table
      .foreign('user_id', 'fk_leaves_user')
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
  });

  await knex.raw(
    'ALTER TABLE `leaves` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('leaves');
}
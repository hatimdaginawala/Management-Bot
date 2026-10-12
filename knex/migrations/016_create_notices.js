/**
 * notices — inactivity, warnings, administrative, and other notices.
 *
 * A user may have multiple concurrent notices. The `grants_quota_exemption`
 * flag controls whether the notice exempts quota during its lifetime.
 *
 * `pending_extension_*` fields support the /notice extend flow: a user
 * requests an extension; an admin approves or rejects it.
 */
export async function up(knex) {
  await knex.schema.createTable('notices', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.bigInteger('user_id').unsigned().notNullable();
    table.string('discord_id', 32).notNullable();

    table
      .enu('type', ['INACTIVITY', 'WARNING', 'ADMINISTRATIVE', 'OTHER'], {
        useNative: true,
        enumName: 'notices_type_enum',
      })
      .notNullable();

    table.text('reason').notNullable();

    table.dateTime('start_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('end_at').nullable();

    table
      .enu('status', ['ACTIVE', 'EXPIRED', 'CANCELLED'], {
        useNative: true,
        enumName: 'notices_status_enum',
      })
      .notNullable()
      .defaultTo('ACTIVE');

    table.boolean('grants_quota_exemption').notNullable().defaultTo(false);

    table.string('created_by', 32).notNullable();
    table.dateTime('expired_at').nullable();
    table.string('cancelled_by', 32).nullable();
    table.dateTime('cancelled_at').nullable();
    table.string('cancellation_reason', 500).nullable();

    table.text('notes').nullable();

    // Pending extension sub-fields (flattened)
    table
      .enu('pending_extension_status', ['NONE', 'PENDING', 'APPROVED', 'REJECTED'], {
        useNative: true,
        enumName: 'notices_pending_extension_status_enum',
      })
      .notNullable()
      .defaultTo('NONE');

    table.string('pending_extension_requested_by', 32).nullable();
    table.dateTime('pending_extension_requested_at').nullable();
    table.dateTime('pending_extension_new_end_at').nullable();
    table.string('pending_extension_reason', 500).nullable();
    table.string('pending_extension_reviewed_by', 32).nullable();
    table.dateTime('pending_extension_reviewed_at').nullable();
    table.string('pending_extension_review_reason', 500).nullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.index(['user_id', 'status'], 'idx_notices_user_status');
    table.index(['discord_id'], 'idx_notices_discord_id');
    table.index(['status', 'end_at'], 'idx_notices_status_end_at');
    table.index(['pending_extension_status'], 'idx_notices_pending_extension_status');

    table
      .foreign('user_id', 'fk_notices_user')
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
  });

  await knex.raw(
    'ALTER TABLE `notices` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('notices');
}
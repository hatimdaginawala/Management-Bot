/**
 * events — event records with approval lifecycle.
 *
 * Host fields are snapshotted (denormalized) for query performance and
 * stable history. `event_type_key` is also snapshotted for aggregation
 * without joins.
 */
export async function up(knex) {
  await knex.schema.createTable('events', (table) => {
    table.bigIncrements('id').unsigned().primary();

    // Host snapshot
    table.bigInteger('host_user_id').unsigned().nullable();
    table.string('host_discord_id', 32).notNullable();
    table.string('host_discord_username', 64).nullable();
    table.string('host_roblox_id', 32).nullable();
    table.string('host_roblox_username', 64).nullable();

    // Event type reference + snapshot
    table.bigInteger('event_type_id').unsigned().notNullable();
    table.string('event_type_key', 32).notNullable();

    table.string('proof_url', 500).notNullable();
    table.text('notes').nullable();

    table
      .enu('status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], {
        useNative: true,
        enumName: 'events_status_enum',
      })
      .notNullable()
      .defaultTo('PENDING');

    table.string('created_by', 32).notNullable();
    table.string('approved_by', 32).nullable();
    table.dateTime('approved_at').nullable();
    table.string('rejected_by', 32).nullable();
    table.dateTime('rejected_at').nullable();
    table.string('rejection_reason', 500).nullable();
    table.string('cancelled_by', 32).nullable();
    table.dateTime('cancelled_at').nullable();
    table.string('cancellation_reason', 500).nullable();

    table.dateTime('cooldown_anchor').notNullable().defaultTo(knex.fn.now());

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.index(['host_discord_id', 'created_at'], 'idx_events_host_discord_created');
    table.index(['status', 'event_type_key', 'created_at'], 'idx_events_status_type_created');
    table.index(['cooldown_anchor'], 'idx_events_cooldown_anchor');
    table.index(['status'], 'idx_events_status');

    table
      .foreign('host_user_id', 'fk_events_host_user')
      .references('id')
      .inTable('users')
      .onDelete('SET NULL')
      .onUpdate('CASCADE');

    table
      .foreign('event_type_id', 'fk_events_event_type')
      .references('id')
      .inTable('event_types')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
  });

  await knex.raw(
    'ALTER TABLE `events` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('events');
}
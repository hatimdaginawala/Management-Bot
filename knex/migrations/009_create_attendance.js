/**
 * attendance — canonical attendance rows.
 *
 * Rows are created when an event is approved (fan-out from the event's
 * attendee list). The unique (event_id, user_id) constraint is the
 * idempotency anchor for that fan-out.
 *
 * Manual removals are soft-deletes: active = 0, status = MANUAL_REMOVED.
 * Historical rows are never deleted.
 */
export async function up(knex) {
  await knex.schema.createTable('attendance', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.bigInteger('event_id').unsigned().notNullable();
    table.string('event_type_key', 32).notNullable();

    table.bigInteger('user_id').unsigned().notNullable();
    table.string('discord_id', 32).notNullable();
    table.string('roblox_id', 32).nullable();

    table.dateTime('event_at').notNullable();

    table
      .enu('status', ['PRESENT', 'MANUAL_ADDED', 'MANUAL_REMOVED'], {
        useNative: true,
        enumName: 'attendance_status_enum',
      })
      .notNullable()
      .defaultTo('PRESENT');

    table.boolean('active').notNullable().defaultTo(true);

    table.string('added_by', 32).nullable();
    table.string('removed_by', 32).nullable();
    table.string('reason', 500).nullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.unique(['event_id', 'user_id'], { indexName: 'uniq_attendance_event_user' });
    table.index(['user_id', 'active', 'event_at'], 'idx_attendance_user_active_event_at');
    table.index(['event_id', 'active'], 'idx_attendance_event_active');
    table.index(['discord_id'], 'idx_attendance_discord_id');

    table
      .foreign('event_id', 'fk_attendance_event')
      .references('id')
      .inTable('events')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');

    table
      .foreign('user_id', 'fk_attendance_user')
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
  });

  await knex.raw(
    'ALTER TABLE `attendance` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('attendance');
}
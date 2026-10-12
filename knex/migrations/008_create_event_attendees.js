/**
 * event_attendees — child table for event attendee entries.
 *
 * In MongoDB, this was an array on the Event document. In MySQL, it's
 * a proper child table with a foreign key.
 *
 * Attendees may be:
 *   - A linked Discord user (discord_id + resolved_user_id)
 *   - A raw Roblox username (roblox_username, is_verified = 0)
 */
export async function up(knex) {
  await knex.schema.createTable('event_attendees', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.bigInteger('event_id').unsigned().notNullable();

    table.string('discord_id', 32).nullable();
    table.string('roblox_username', 64).nullable();
    table.bigInteger('resolved_user_id').unsigned().nullable();
    table.boolean('is_verified').notNullable().defaultTo(false);

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['event_id'], 'idx_event_attendees_event_id');
    table.index(['discord_id'], 'idx_event_attendees_discord_id');
    table.index(['resolved_user_id'], 'idx_event_attendees_resolved_user');

    table
      .foreign('event_id', 'fk_event_attendees_event')
      .references('id')
      .inTable('events')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');

    table
      .foreign('resolved_user_id', 'fk_event_attendees_resolved_user')
      .references('id')
      .inTable('users')
      .onDelete('SET NULL')
      .onUpdate('CASCADE');
  });

  await knex.raw(
    'ALTER TABLE `event_attendees` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('event_attendees');
}
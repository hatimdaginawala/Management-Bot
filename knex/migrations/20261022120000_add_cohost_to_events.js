// migrations/20261022120000_add_cohost_to_events.js

export async function up(knex) {
  await knex.schema.alterTable('events', (table) => {
    table.bigInteger('cohost_user_id').unsigned().nullable();
    table.string('cohost_discord_id', 32).nullable();
    table.string('cohost_discord_username', 100).nullable();

    table.foreign('cohost_user_id')
      .references('id').inTable('users')
      .onDelete('SET NULL');
  });

  await knex.schema.alterTable('events', (table) => {
    table.index('cohost_discord_id');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('events', (table) => {
    table.dropForeign('cohost_user_id');
  });

  await knex.schema.alterTable('events', (table) => {
    table.dropColumn('cohost_user_id');
    table.dropColumn('cohost_discord_id');
    table.dropColumn('cohost_discord_username');
  });
}
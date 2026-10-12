/**
 * role_assignments — join table between users and roles.
 *
 * "One active assignment per (user, role)" is enforced at the service
 * layer via INSERT ... WHERE NOT EXISTS, because MySQL disallows the
 * generated-column + foreign-key combination on the same column.
 */
export async function up(knex) {
  await knex.schema.createTable('role_assignments', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.bigInteger('user_id').unsigned().notNullable();
    table.string('discord_id', 32).notNullable();
    table.bigInteger('role_id').unsigned().notNullable();
    table.string('role_key', 64).notNullable();

    table.string('assigned_by', 32).notNullable().defaultTo('system');
    table.dateTime('assigned_at').notNullable().defaultTo(knex.fn.now());

    table.dateTime('removed_at').nullable();
    table.string('removed_by', 32).nullable();
    table.string('reason', 255).nullable();

    table.boolean('active').notNullable().defaultTo(true);

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.index(['user_id', 'active'], 'idx_role_assignments_user_active');
    table.index(['role_id', 'active'], 'idx_role_assignments_role_active');
    table.index(['discord_id'], 'idx_role_assignments_discord_id');

    table
      .foreign('user_id', 'fk_role_assignments_user')
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');

    table
      .foreign('role_id', 'fk_role_assignments_role')
      .references('id')
      .inTable('roles')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
  });

  await knex.raw(
    'ALTER TABLE `role_assignments` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('role_assignments');
}
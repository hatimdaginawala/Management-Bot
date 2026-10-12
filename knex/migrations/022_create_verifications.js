/**
 * verifications — /auth link → /auth verify lifecycle.
 *
 * "One PENDING verification per user" is enforced at the service layer
 * via insert-if-not-exists. The code column remains globally unique
 * (that's a real unique constraint, not a partial one, and doesn't
 * rely on generated columns).
 */
export async function up(knex) {
  await knex.schema.createTable('verifications', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table.string('discord_id', 32).notNullable();
    table.string('roblox_username', 64).notNullable();
    table.string('roblox_id', 32).nullable();

    table.string('code', 16).notNullable();

    table
      .enu('status', ['PENDING', 'VERIFIED', 'EXPIRED', 'CANCELLED', 'FAILED'], {
        useNative: true,
        enumName: 'verifications_status_enum',
      })
      .notNullable()
      .defaultTo('PENDING');

    table.dateTime('expires_at').notNullable();
    table.dateTime('verified_at').nullable();
    table.integer('attempts').unsigned().notNullable().defaultTo(0);
    table.string('failure_reason', 255).nullable();

    table
      .enu('initiated_from', ['DISCORD', 'REST'], {
        useNative: true,
        enumName: 'verifications_initiated_from_enum',
      })
      .notNullable()
      .defaultTo('DISCORD');

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.unique(['code'], { indexName: 'uniq_verifications_code' });
    table.index(['discord_id'], 'idx_verifications_discord_id');
    table.index(['roblox_id'], 'idx_verifications_roblox_id');
    table.index(['status', 'expires_at'], 'idx_verifications_status_expires_at');
    table.index(['discord_id', 'status'], 'idx_verifications_discord_status');
  });

  await knex.raw(
    'ALTER TABLE `verifications` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('verifications');
}
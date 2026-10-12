/**
 * users — central identity table.
 *
 * Discord ID is the anchor; Roblox data is a snapshot from sync.
 * Columns are flattened from the MongoDB `User` document (nested
 * `roblox.*` and `quota.*` sub-documents).
 */
export async function up(knex) {
  await knex.schema.createTable('users', (table) => {
    table.bigIncrements('id').unsigned().primary();

    // Discord-owned identity
    table.string('discord_id', 32).notNullable();
    table.string('discord_username', 64).nullable();

    // Roblox-owned identity (populated by verification + sync)
    table.string('roblox_id', 32).nullable();
    table.string('roblox_username', 64).nullable();
    table.string('roblox_display_name', 64).nullable();
    table.integer('roblox_rank_id').nullable();
    table.string('roblox_rank_name', 64).nullable();
    table.integer('roblox_rank_value').nullable();
    table.dateTime('roblox_last_synced_at').nullable();

    // Application-owned state
    table
      .enu('status', ['ACTIVE', 'LEFT_ROBLOX_GROUP', 'UNVERIFIED', 'SUSPENDED', 'INACTIVE'], {
        useNative: true,
        enumName: 'users_status_enum',
      })
      .notNullable()
      .defaultTo('UNVERIFIED');

    // Quota sub-document (flattened)
    table.boolean('quota_exempt').notNullable().defaultTo(false);
    table.dateTime('quota_exempt_until').nullable();
    table.string('quota_exempt_reason', 255).nullable();
    table
      .enu('quota_category', ['NONE', 'STAFF', 'LOW_RANK'], {
        useNative: true,
        enumName: 'users_quota_category_enum',
      })
      .notNullable()
      .defaultTo('NONE');

    // Lifecycle timestamps
    table.dateTime('joined_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('last_left_roblox_at').nullable();
    table.dateTime('last_rejoined_roblox_at').nullable();
    table.dateTime('last_unlinked_at').nullable();
    table.dateTime('suspended_at').nullable();
    table.string('suspension_reason', 255).nullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    // Indexes
    table.unique(['discord_id'], { indexName: 'uniq_users_discord_id' });
    table.unique(['roblox_id'], { indexName: 'uniq_users_roblox_id' });
    table.index(['status'], 'idx_users_status');
    table.index(['status', 'quota_category'], 'idx_users_status_quota_cat');
    table.index(['roblox_rank_value'], 'idx_users_roblox_rank_value');
  });

  // Set table options
  await knex.raw(
    'ALTER TABLE `users` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('users');
}
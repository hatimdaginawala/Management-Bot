/**
 * reports — persisted weekly/monthly/manual reports.
 *
 * Scheduled reports have a deterministic report_key ("2026-W41").
 * Uniqueness is enforced at the service layer via insert-if-not-exists.
 *
 * JSON columns have no defaults — the app always supplies them.
 */
export async function up(knex) {
  await knex.schema.createTable('reports', (table) => {
    table.bigIncrements('id').unsigned().primary();

    table
      .enu('kind', ['WEEKLY', 'MONTHLY', 'MANUAL'], {
        useNative: true,
        enumName: 'reports_kind_enum',
      })
      .notNullable();

    table.string('report_key', 32).nullable();

    table.dateTime('period_start').notNullable();
    table.dateTime('period_end').notNullable();

    table.dateTime('generated_at').notNullable().defaultTo(knex.fn.now());
    table.string('generated_by', 32).notNullable().defaultTo('system');

    table.string('channel_id', 32).nullable();
    table.string('message_id', 32).nullable();

    table.string('label', 128).nullable();

    table.integer('active_members').unsigned().notNullable().defaultTo(0);
    table.integer('total_events').unsigned().notNullable().defaultTo(0);
    table.integer('total_attendance').unsigned().notNullable().defaultTo(0);
    table.integer('new_strikes').unsigned().notNullable().defaultTo(0);
    table.integer('recovered_strikes').unsigned().notNullable().defaultTo(0);
    table.integer('pending_removals').unsigned().notNullable().defaultTo(0);
    table.integer('active_leaves').unsigned().notNullable().defaultTo(0);
    table.integer('active_notices').unsigned().notNullable().defaultTo(0);

    table.integer('staff_completed').unsigned().notNullable().defaultTo(0);
    table.integer('staff_missed').unsigned().notNullable().defaultTo(0);
    table.integer('low_rank_completed').unsigned().notNullable().defaultTo(0);
    table.integer('low_rank_missed').unsigned().notNullable().defaultTo(0);

    table.json('events_by_type_json').notNullable();
    table.json('top_hosts_json').notNullable();
    table.json('top_attendees_json').notNullable();
    table.json('sync_summary_json').notNullable();
    table.json('rendered_payload_json').nullable();

    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table
      .dateTime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.index(['kind', 'generated_at'], 'idx_reports_kind_generated_desc');
    table.index(['kind', 'report_key'], 'idx_reports_kind_key');
  });

  await knex.raw(
    'ALTER TABLE `reports` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('reports');
}
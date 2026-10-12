import 'dotenv/config';

/**
 * Knex configuration for the 24th Guard Rifles bot.
 *
 * - Uses mysql2 as the driver
 * - Forces utf8mb4 charset and UTC timezone on every connection
 * - Pool sizing tuned for a single-instance Discord bot
 * - In tests, uses MYSQL_TEST_DATABASE
 *
 * Migrations live in ./knex/migrations
 * Seeds live in ./knex/seeds
 */

// Force UTC on all connections. Knex doesn't have a single option for
// this, so we inject `SET time_zone='+00:00'` via the `afterCreate` hook.
function forceUtc(connection, done) {
  connection.query("SET time_zone = '+00:00'", (err) => {
    done(err, connection);
  });
}

const BASE = {
  client: 'mysql2',
  connection: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    charset: 'utf8mb4',
    timezone: 'Z',
    // Prevent `DATE` / `DATETIME` values from being converted using the
    // OS timezone. Combined with the +00:00 session timezone, all timestamps
    // round-trip as UTC.
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  },
  pool: {
    min: 2,
    max: 10,
    afterCreate: forceUtc,
  },
  migrations: {
    directory: './knex/migrations',
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: './knex/seeds',
  },
};

const config = {
  development: { ...BASE },

  test: {
    ...BASE,
    connection: {
      ...BASE.connection,
      database: process.env.MYSQL_TEST_DATABASE || 'guard24_test',
    },
    pool: { min: 1, max: 5, afterCreate: forceUtc },
  },

  production: {
    ...BASE,
    pool: { min: 2, max: 20, afterCreate: forceUtc },
  },
};

export default config;
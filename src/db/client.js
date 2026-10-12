import knex from 'knex';
import config from '../config/index.js';
import logger from '../config/logger.js';

/**
 * Knex client. Single instance for the whole app.
 *
 * During the MongoDB → MySQL migration (M1–M2), the app still uses
 * Mongoose for data access. This client sits alongside, ready for
 * services to switch to in M3.
 */

const connection = {
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  charset: 'utf8mb4',
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: false,
};

export const db = knex({
  client: 'mysql2',
  connection,
  pool: {
    min: 2,
    max: 10,
    afterCreate: (conn, done) => {
      conn.query("SET time_zone = '+00:00'", (err) => done(err, conn));
    },
  },
});

/**
 * Verify the MySQL connection is reachable. Used by M1 verification.
 * Not called from `server.js` yet — will be in M3.
 */
export async function verifyConnection() {
  try {
    const [rows] = await db.raw('SELECT 1 AS ok');
    return { ok: true, result: rows };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Graceful shutdown for the pool. Will be wired into `server.js` in M3.
 */
export async function closeDb() {
  await db.destroy();
  logger.info('MySQL pool closed');
}

let isConnected = false;

export async function connectDatabase({ retries = 5, delayMs = 2000 } = {}) {
  if (isConnected) return;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await db.raw('SELECT 1');
      isConnected = true;
      logger.info(
        {
          host: config.mysql.host,
          port: config.mysql.port,
          database: config.mysql.database,
        },
        'MySQL connected'
      );
      return;
    } catch (err) {
      logger.error(
        { attempt, retries, err: err.message },
        'MySQL connection failed'
      );
      if (attempt === retries) throw err;
      const wait = delayMs * attempt;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export async function disconnectDatabase() {
  if (!isConnected) return;
  await db.destroy();
  isConnected = false;
  logger.info('MySQL disconnected');
}

export async function isDatabaseHealthy() {
  try {
    await db.raw('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
// import knex from 'knex';
// import config from './index.js';
// import logger from './logger.js';

// /**
//  * Knex connection factory.
//  *
//  * Exposes:
//  *   - `db`          the Knex instance (query builder)
//  *   - `connectDatabase()`  verifies connectivity at boot
//  *   - `disconnectDatabase()`  closes the pool on shutdown
//  *   - `isDatabaseHealthy()`   boolean for /health
//  */

// const clientOptions = {
//   client: 'mysql2',
//   connection: {
//     host: config.mysql.host,
//     port: config.mysql.port,
//     user: config.mysql.user,
//     password: config.mysql.password,
//     database: config.mysql.database,
//     charset: 'utf8mb4',
//     timezone: 'Z',
//     supportBigNumbers: true,
//     bigNumberStrings: false,
//   },
//   pool: {
//     min: 2,
//     max: 10,
//     afterCreate: (connection, done) => {
//       connection.query("SET time_zone = '+00:00'", (err) => {
//         done(err, connection);
//       });
//     },
//   },
// };

// export const db = knex(clientOptions);

// let isConnected = false;

// /**
//  * Verify the connection works. Runs a trivial `SELECT 1`.
//  * Retries with exponential backoff on failure.
//  */
// export async function connectDatabase({ retries = 5, delayMs = 2000 } = {}) {
//   for (let attempt = 1; attempt <= retries; attempt++) {
//     try {
//       await db.raw('SELECT 1');
//       isConnected = true;
//       logger.info(
//         {
//           host: config.mysql.host,
//           port: config.mysql.port,
//           database: config.mysql.database,
//         },
//         'MySQL connected'
//       );
//       return;
//     } catch (err) {
//       logger.error(
//         { attempt, retries, err: err.message },
//         'MySQL connection failed'
//       );
//       if (attempt === retries) throw err;
//       const wait = delayMs * attempt;
//       await new Promise((r) => setTimeout(r, wait));
//     }
//   }
// }

// /**
//  * Close the pool. Called during graceful shutdown.
//  */
// export async function disconnectDatabase() {
//   if (!isConnected) return;
//   await db.destroy();
//   isConnected = false;
//   logger.info('MySQL disconnected');
// }

// /**
//  * Health check for the REST /health endpoint.
//  */
// export async function isDatabaseHealthy() {
//   try {
//     await db.raw('SELECT 1');
//     return true;
//   } catch {
//     return false;
//   }
// }


import knex from 'knex';
import config from './index.js';
import logger from './logger.js';

/**
 * Knex connection factory.
 *
 * Exposes:
 *   - db                    Knex instance
 *   - connectDatabase()     Verifies connectivity at boot
 *   - disconnectDatabase()  Closes the pool on shutdown
 *   - isDatabaseHealthy()   Boolean for /health
 */

const clientOptions = {
  client: 'mysql2',

  connection: {
    host: config.mysql.host,
    port: Number(config.mysql.port || 4000),
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,

    charset: 'utf8mb4',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: false,

    // TiDB Cloud requires encrypted connections.
    ssl: {
      minVersion: 'TLSv1.2',
    },
  },

  pool: {
    min: 0,
    max: 10,

    afterCreate: (connection, done) => {
      connection.query("SET time_zone = '+00:00'", (err) => {
        done(err, connection);
      });
    },
  },
};

export const db = knex(clientOptions);

let isConnected = false;

/**
 * Verify connectivity with retries and linear backoff.
 */
export async function connectDatabase({
  retries = 5,
  delayMs = 2000,
} = {}) {
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
        {
          attempt,
          retries,
          err: err.message,
        },
        'MySQL connection failed'
      );

      if (attempt === retries) {
        throw err;
      }

      const wait = delayMs * attempt;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/**
 * Close the pool during graceful shutdown.
 */
export async function disconnectDatabase() {
  await db.destroy();
  isConnected = false;
  logger.info('MySQL disconnected');
}

/**
 * Health check for the REST /health endpoint.
 */
export async function isDatabaseHealthy() {
  try {
    await db.raw('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

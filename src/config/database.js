import mongoose from 'mongoose';
import config from './index.js';
import logger from './logger.js';

let isConnected = false;

/**
 * Connect to MongoDB. Retries with exponential backoff on failure.
 */
export async function connectDatabase({ retries = 5, delayMs = 2000 } = {}) {
  if (isConnected) return mongoose.connection;

  mongoose.set('strictQuery', true);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(config.mongo.uri, {
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
      });
      isConnected = true;
      logger.info({ uri: maskUri(config.mongo.uri) }, 'MongoDB connected');
      return mongoose.connection;
    } catch (err) {
      logger.error(
        { attempt, retries, err: err.message },
        'MongoDB connection failed'
      );
      if (attempt === retries) throw err;
      const wait = delayMs * attempt;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/**
 * Disconnect from MongoDB (used on shutdown).
 */
export async function disconnectDatabase() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  logger.info('MongoDB disconnected');
}

/**
 * Return true if MongoDB is currently reachable.
 * Used by /health.
 */
export function isDatabaseHealthy() {
  return mongoose.connection.readyState === 1;
}

function maskUri(uri) {
  return uri.replace(/\/\/[^@]+@/, '//***:***@');
}
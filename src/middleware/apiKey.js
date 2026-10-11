import crypto from 'node:crypto';
import config from '../config/index.js';
import {
  AuthenticationError,
  AppError,
} from '../utils/errors.js';

export function apiKey(req, _res, next) {
  const expected = config.api.key;

  if (!expected) {
    return next(
      new AppError(
        'API authentication is not configured on this server.',
        { code: 'API_AUTH_NOT_CONFIGURED', statusCode: 503 }
      )
    );
  }

  const provided = req.header('x-api-key');
  if (!provided || typeof provided !== 'string') {
    return next(new AuthenticationError('Missing X-API-Key header.'));
  }

  if (!constantTimeEqual(provided, expected)) {
    return next(new AuthenticationError('Invalid API key.'));
  }

  return next();
}

function constantTimeEqual(a, b) {
  const aBuf = Buffer.from(String(a), 'utf8');
  const bBuf = Buffer.from(String(b), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}
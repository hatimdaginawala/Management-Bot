import { AppError } from '../utils/errors.js';
import logger from '../config/logger.js';
import config from '../config/index.js';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const isOperational = err instanceof AppError && err.isOperational;
  const statusCode = isOperational ? err.statusCode : 500;

  if (isOperational) {
    logger.warn(
      {
        code: err.code,
        statusCode,
        path: req.originalUrl,
        method: req.method,
        details: err.details,
      },
      err.message
    );
  } else {
    logger.error(
      {
        err: { message: err.message, stack: err.stack, name: err.name },
        path: req.originalUrl,
        method: req.method,
      },
      'Unhandled error'
    );
  }

  const body = {
    success: false,
    error: {
      code: isOperational ? err.code : 'INTERNAL_ERROR',
      message: isOperational ? err.message : 'An unexpected error occurred.',
    },
  };

  if (isOperational && err.details) body.error.details = err.details;

  // Stack traces only in non-prod, and only for operational errors
  if (!config.isProduction && isOperational) {
    body.error.stack = err.stack;
  }

  res.status(statusCode).json(body);
}
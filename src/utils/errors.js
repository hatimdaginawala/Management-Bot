/**
 * Base application error. All domain-specific errors extend this.
 */
export class AppError extends Error {
  constructor(message, { code, statusCode = 500, details = null, cause } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code || this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    if (cause) this.cause = cause;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 400, details });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message, { code: 'AUTHORIZATION_ERROR', statusCode: 403 });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required.') {
    super(message, { code: 'AUTHENTICATION_ERROR', statusCode: 401 });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', details) {
    super(`${resource} not found.`, {
      code: 'NOT_FOUND',
      statusCode: 404,
      details,
    });
  }
}

export class ConflictError extends AppError {
  constructor(message, details) {
    super(message, { code: 'CONFLICT', statusCode: 409, details });
  }
}

export class ExternalAPIError extends AppError {
  constructor(service, message, details) {
    super(`${service} request failed: ${message}`, {
      code: 'EXTERNAL_API_ERROR',
      statusCode: 502,
      details,
    });
  }
}

export class DatabaseError extends AppError {
  constructor(message, details) {
    super(message, { code: 'DATABASE_ERROR', statusCode: 500, details });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please try again later.') {
    super(message, { code: 'RATE_LIMIT', statusCode: 429 });
  }
}
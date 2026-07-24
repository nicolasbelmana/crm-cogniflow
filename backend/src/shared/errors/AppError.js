/**
 * Base class for all predictable, "operational" errors that the API can
 * translate directly into an HTTP response (validation failures, missing
 * resources, conflicts, etc). Anything that is NOT an AppError is treated
 * as an unexpected/programmer error by the central error handler and
 * answered with a generic 500, so we never leak internals to clients.
 *
 * `payload` holds any extra fields that should be merged into the JSON
 * response alongside `error` (e.g. `{ details: [...] }` or
 * `{ parseErrors: [...] }`). This keeps the response "shape" fully decided
 * by whoever throws the error, without the error handler needing to know
 * about every possible use case (Open/Closed Principle: new error shapes
 * don't require touching the handler).
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, payload = {}, code = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.payload = payload;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(details, message = 'Validation failed') {
    super(message, 400, { details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409);
  }
}

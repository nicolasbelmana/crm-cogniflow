import { AppError } from './AppError.js';

/**
 * Single place that decides how a thrown error becomes an HTTP response.
 * Controllers/services never call `res.status(...).json(...)` for error
 * cases themselves — they just `throw`. This keeps HTTP-shape concerns out
 * of business logic and means the response format can evolve in one spot.
 *
 * Must be registered LAST, after every route, so Express treats it as the
 * error-handling middleware (4 arguments).
 */
export function errorHandler(error, req, res, _next) {
  if (error instanceof AppError) {
    return res
      .status(error.statusCode)
      .json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...error.payload });
  }

  // Unexpected/programmer error: log full detail server-side, never leak it.
  console.error(`[unhandled] ${req.method} ${req.originalUrl}:`, error);
  return res.status(500).json({ error: 'Internal server error' });
}

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Route not found' });
}

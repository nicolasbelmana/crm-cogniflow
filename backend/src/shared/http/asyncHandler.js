/**
 * Wraps an async Express handler so rejected promises are forwarded to
 * `next(error)` automatically, instead of every controller needing its own
 * try/catch. Keeps controllers focused on request/response mapping only.
 */
export function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

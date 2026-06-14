/**
 * errorHandler.js — Global Express Error Handler
 *
 * Express identifies a middleware as an error handler when it has
 * exactly 4 parameters: (err, req, res, next).
 *
 * This must be registered LAST in app.js, after all routes.
 * Any route that calls next(err) or throws inside an async wrapper
 * will land here.
 *
 * Design decision: Centralize all error responses here so that:
 *   - Routes never write their own error JSON structures
 *   - Error format is consistent across the entire API
 *   - Logging (or future monitoring integration) is in one place
 */

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Log the full stack in development so engineers see the trace.
  // In production, use a structured logger (e.g., Winston, Pino).
  console.error(`[ERROR] ${err.stack || err.message}`);

  // Some errors intentionally carry a statusCode (e.g., validation errors).
  // Fall back to 500 if none was set.
  const statusCode = err.statusCode || 500;
  const message    = err.message    || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
  });
}

/**
 * createError — Factory for intentional HTTP errors.
 *
 * Usage in a route:
 *   throw createError(404, 'Group not found');
 *
 * The error propagates to errorHandler via the asyncHandler wrapper.
 */
export function createError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * asyncHandler — Wraps an async route handler to catch rejected promises
 * and forward them to errorHandler via next(err).
 *
 * Without this wrapper, an unhandled Promise rejection in a route
 * would crash the process (Node < 15) or produce an UnhandledPromiseRejection
 * warning (Node 15+) without sending an HTTP response.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

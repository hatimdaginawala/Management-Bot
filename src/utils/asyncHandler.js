/**
 * Wraps an async Express route handler so rejections propagate to next().
 */
export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
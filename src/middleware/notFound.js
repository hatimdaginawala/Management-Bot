import { NotFoundError } from '../utils/errors.js';

export function notFound(req, _res, next) {
  next(new NotFoundError('Route', { method: req.method, path: req.originalUrl }));
}
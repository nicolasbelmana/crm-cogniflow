import passport from 'passport';
import { UnauthorizedError } from '../errors/AppError.js';

/**
 * Verifies the JWT bearer token via the 'jwt' passport strategy (configured
 * in modules/auth/auth.strategies.js) and attaches the sanitized user to
 * `req.user`. Any failure becomes an UnauthorizedError, handled centrally
 * by shared/errors/errorHandler.js.
 */
export function requireAuth(req, res, next) {
  passport.authenticate('jwt', { session: false }, (error, user, info) => {
    if (error) {
      return next(error);
    }

    if (!user) {
      return next(new UnauthorizedError(info?.message || 'Unauthorized'));
    }

    req.user = user;
    return next();
  })(req, res, next);
}

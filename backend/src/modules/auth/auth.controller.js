import passport from 'passport';
import { validateRegisterInput } from './auth.validator.js';

/**
 * Translates HTTP requests into service calls and service results into HTTP
 * responses. No SQL, no validation rules, no hashing here — just mapping.
 */
export function createAuthController({ authService }) {
  return {
    async register(req, res) {
      const input = validateRegisterInput(req.body);
      const { user, token } = await authService.register(input);
      res.status(201).json({ user, token });
    },

    login(req, res, next) {
      passport.authenticate('local', { session: false }, (error, user, info) => {
        if (error) {
          return next(error);
        }

        if (!user) {
          return res.status(401).json({ error: info?.message || 'Invalid email or password' });
        }

        const token = authService.issueToken(user);
        return res.json({ user, token });
      })(req, res, next);
    },

    async logout(_req, res) {
      res.json({ message: 'Logged out successfully' });
    },

    async me(req, res) {
      res.json({ user: req.user });
    },
  };
}

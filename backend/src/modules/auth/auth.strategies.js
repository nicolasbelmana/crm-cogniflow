import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { toPublicUser } from './auth.mapper.js';

/**
 * Registers the passport strategies used by the API. Both strategies are
 * built from injected dependencies (repository + hasher + secret) instead of
 * reaching for a global pool/bcrypt import, so they can be unit tested with
 * fakes and swapped without touching this wiring (Dependency Inversion).
 */
export function configureAuthStrategies(passportInstance, { userRepository, passwordHasher, jwtSecret }) {
  passportInstance.use(
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password' },
      async (email, password, done) => {
        try {
          const normalizedEmail = (email || '').trim().toLowerCase();
          const user = await userRepository.findByEmail(normalizedEmail);

          if (!user) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          const isValid = await passwordHasher.compare(password, user.password_hash);

          if (!isValid) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          return done(null, toPublicUser(user));
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passportInstance.use(
    new JwtStrategy(
      {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: jwtSecret,
      },
      async (payload, done) => {
        try {
          const user = await userRepository.findById(payload.sub);

          if (!user) {
            return done(null, false);
          }

          return done(null, toPublicUser(user));
        } catch (error) {
          return done(error, false);
        }
      }
    )
  );

  return passportInstance;
}

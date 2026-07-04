import express from 'express';
import cors from 'cors';
import passport from 'passport';
import { config } from './shared/config/index.js';
import { pool } from './shared/database/pool.js';
import { passwordHasher } from './shared/security/passwordHasher.js';
import { createTokenService } from './shared/security/tokenService.js';
import { errorHandler, notFoundHandler } from './shared/errors/errorHandler.js';

import { createUserRepository } from './modules/auth/auth.repository.js';
import { configureAuthStrategies } from './modules/auth/auth.strategies.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createAuthController } from './modules/auth/auth.controller.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';

import { createLeadsRepository } from './modules/leads/leads.repository.js';
import { createLeadsService } from './modules/leads/leads.service.js';
import { createLeadsController } from './modules/leads/leads.controller.js';
import { createLeadsRouter } from './modules/leads/leads.routes.js';

/**
 * Composition root: the ONE place that wires concrete implementations
 * (Postgres pool, bcrypt, jsonwebtoken) into the abstractions that
 * services/controllers depend on. Every module below this point only knows
 * about the interfaces it was handed — there are no hidden singleton
 * imports buried inside business logic (Dependency Inversion Principle).
 *
 * Exported as a factory (instead of side-effecting on import) so tests can
 * call `createApp()` and drive it with supertest without binding a port.
 */
export function createApp() {
  const tokenService = createTokenService({
    secret: config.jwtSecret,
    expiresIn: config.jwtExpiresIn,
  });

  const userRepository = createUserRepository(pool);
  const leadsRepository = createLeadsRepository(pool);

  configureAuthStrategies(passport, {
    userRepository,
    passwordHasher,
    jwtSecret: config.jwtSecret,
  });

  const authService = createAuthService({ userRepository, passwordHasher, tokenService });
  const authController = createAuthController({ authService });

  const leadsService = createLeadsService({ leadsRepository });
  const leadsController = createLeadsController({ leadsService });

  const app = express();

  app.use(
    cors({
      origin: config.frontendUrl,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(passport.initialize());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', createAuthRouter(authController));
  app.use('/leads', createLeadsRouter(leadsController));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

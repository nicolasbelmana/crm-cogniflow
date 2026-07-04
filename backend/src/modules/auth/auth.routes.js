import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';

/**
 * Thin HTTP wiring only: verb + path -> controller method. No logic lives
 * here, which makes it trivial to see the whole public surface of the
 * auth module at a glance.
 */
export function createAuthRouter(authController) {
  const router = Router();

  router.post('/register', asyncHandler(authController.register));
  router.post('/login', authController.login);
  router.post('/logout', requireAuth, asyncHandler(authController.logout));
  router.get('/me', requireAuth, asyncHandler(authController.me));

  return router;
}

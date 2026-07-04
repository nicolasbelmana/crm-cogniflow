import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';

/**
 * Thin HTTP wiring only: verb + path -> controller method. No logic lives
 * here, which makes it trivial to see the whole public surface of the
 * leads module at a glance.
 */
export function createLeadsRouter(leadsController) {
  const router = Router();

  router.use(requireAuth);

  router.get('/', asyncHandler(leadsController.list));
  router.post('/', asyncHandler(leadsController.create));
  router.post('/bulk', asyncHandler(leadsController.bulkImport));
  router.get('/:id', asyncHandler(leadsController.getOne));
  router.put('/:id', asyncHandler(leadsController.update));
  router.delete('/:id', asyncHandler(leadsController.remove));

  return router;
}

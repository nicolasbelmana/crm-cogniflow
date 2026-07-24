import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';

/**
 * Thin HTTP wiring only: verb + path -> controller method. No logic lives
 * here, same role as auth.routes.js / leads.routes.js.
 */
export function createClassificationsRouter(classificationsController) {
  const router = Router();

  router.use(requireAuth);

  // Ambos endpoints aceptan el query param opcional `?force=true` (string
  // exacto 'true'; cualquier otro valor u omisión se trata como false —
  // ver `parseForceFlag` en classifications.controller.js) para forzar
  // una reclasificación aunque el `prompt_hash` coincida con la última
  // clasificación guardada (opción 5, docs/OPTIMIZACION_API_CLAUDE.md).
  router.post('/', asyncHandler(classificationsController.classifySingle));
  router.post('/batch', asyncHandler(classificationsController.classifyBatch));
  // Debe declararse antes de '/:leadId' para no ser interceptada por él.
  router.get('/usage', asyncHandler(classificationsController.usageReport));
  router.get('/:leadId', asyncHandler(classificationsController.history));

  return router;
}

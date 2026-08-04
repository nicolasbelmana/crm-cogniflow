import { AppError } from '../../shared/errors/AppError.js';

/**
 * `force` es un query param opcional, string por naturaleza en HTTP
 * (`?force=true`). Se normaliza acá una sola vez a boolean para que
 * ambos endpoints de clasificación (individual y batch) tengan
 * exactamente la misma regla ('true' string -> true, cualquier otra
 * cosa, incluida ausencia -> false) en vez de duplicar la comparación.
 */
function parseForceFlag(req) {
  return req.query?.force === 'true';
}

function parseProvider(req) {
  const providerFromBody = req.body?.provider;
  const providerFromQuery = req.query?.provider;
  const candidate = providerFromBody ?? providerFromQuery;

  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

/**
 * Translates HTTP requests into classificationsService calls and results
 * into responses. No SQL, no AI/provider concerns, no validation rules —
 * just mapping, same role as auth.controller.js / leads.controller.js.
 */
export function createClassificationsController({ classificationsService }) {
  return {
    async classifySingle(req, res) {
      const { leadId } = req.body ?? {};

      if (!leadId || typeof leadId !== 'string') {
        throw new AppError('leadId is required', 400);
      }

      const force = parseForceFlag(req);
      const provider = parseProvider(req);
      const { classification, reused } = await classificationsService.classifyOne(req.user.id, leadId, {
        force,
        provider,
      });
      res.status(201).json({ classification, reused });
    },

    async classifyBatch(req, res) {
      const force = parseForceFlag(req);
      const provider = parseProvider(req);
      const result = await classificationsService.classifyBatch(req.user.id, req.body?.leadIds, {
        force,
        provider,
      });
      res.status(201).json(result);
    },

    async history(req, res) {
      const classifications = await classificationsService.getHistory(req.user.id, req.params.leadId);
      res.json({ classifications });
    },

    async usageReport(req, res) {
      const daysParam = Number.parseInt(req.query?.days, 10);
      const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : undefined;
      const usage = await classificationsService.getUsageReport(req.user.id, { days });
      res.json({ usage });
    },
  };
}

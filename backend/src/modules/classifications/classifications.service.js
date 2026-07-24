import { AppError, NotFoundError } from '../../shared/errors/AppError.js';
import { buildClassificationPrompt, buildBatchClassificationPrompt, hashClassificationPrompt } from './classifications.prompt.js';
import { parseClassifierOutput, parseClassifierBatchOutput } from './classifications.validator.js';

// Leads grouped per Anthropic request (docs/OPTIMIZACION_API_CLAUDE.md,
// item 4). Big enough to meaningfully amortize the fixed system/tool
// overhead across leads, small enough to keep max_tokens/prompt size
// reasonable and to limit blast radius if a single batch call fails.
const BATCH_GROUP_SIZE = 5;

// Umbral simple de reclasificaciones/día (docs/OPTIMIZACION_API_CLAUDE.md,
// opción 6): más allá de este número de clasificaciones para el mismo lead
// en las últimas 24h se corta la llamada a la IA (salvo `force`), para
// evitar gasto descontrolado en un lead que se reclasifica en loop.
const MAX_RECLASSIFICATIONS_PER_DAY = 5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Ventana por defecto del reporte de uso (opción 6).
const DEFAULT_USAGE_REPORT_DAYS = 30;

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function assertReclassificationLimit(classificationsRepository, leadId, userId) {
  const since = new Date(Date.now() - ONE_DAY_MS);
  const count = await classificationsRepository.countByLeadIdSince(leadId, userId, since);

  if (count >= MAX_RECLASSIFICATIONS_PER_DAY) {
    throw new AppError(
      `Lead ${leadId} reached the daily reclassification limit (${MAX_RECLASSIFICATIONS_PER_DAY}/day). Use force=true to override.`,
      429,
      {},
      'DAILY_LIMIT_REACHED'
    );
  }
}

/**
 * Classification use cases. Depends only on abstractions injected by the
 * composition root (app.js): a leads repository (to read the lead being
 * classified), a classifications repository (to persist results) and an
 * AI classifier client (Anthropic today, swappable tomorrow). No SQL, no
 * HTTP, no direct Anthropic SDK usage here — Dependency Inversion, same as
 * auth.service.js / leads.service.js.
 */
export function createClassificationsService({
  leadsRepository,
  classificationsRepository,
  aiClassifierClient,
  model,
}) {
  async function classifyOne(userId, leadId, { force = false } = {}) {
    const lead = await leadsRepository.findByIdForUser(leadId, userId);

    if (!lead) {
      throw new NotFoundError('Lead not found');
    }

    const { systemPrompt, userPrompt } = buildClassificationPrompt(lead);
    const promptHash = hashClassificationPrompt(userPrompt);

    // Opción 5 (docs/OPTIMIZACION_API_CLAUDE.md): if the lead's data hasn't
    // changed since its last classification (same prompt fingerprint),
    // skip the Anthropic call entirely and return the existing result.
    if (!force) {
      const latest = await classificationsRepository.findLatestByLeadId(leadId, userId);
      if (latest && latest.prompt_hash === promptHash) {
        return { classification: latest, reused: true };
      }
    }

    // Opción 6: límite simple de reclasificaciones/día por lead antes de
    // gastar tokens en una llamada real a la IA. `force` también permite
    // saltear este límite (no solo el caché de prompt-hash de arriba),
    // que es justamente lo que el mensaje de error le pide al caller hacer.
    if (!force) {
      await assertReclassificationLimit(classificationsRepository, leadId, userId);
    }

    const result = await aiClassifierClient.classify({ systemPrompt, userPrompt });
    const parsed = parseClassifierOutput(result.parsedInput);

    const classification = await classificationsRepository.create({
      leadId,
      userId,
      ...parsed,
      tokensUsed: result.inputTokens + result.outputTokens,
      modelUsed: model,
      promptHash,
    });

    return { classification, reused: false };
  }

  /**
   * Classifies a group of already-fetched leads (all belonging to
   * `userId`) with a single Anthropic request via `classifyMany`. Persists
   * one classification row per lead, splitting the request's token cost
   * evenly across the group as an approximation (Anthropic doesn't report
   * a per-item breakdown).
   *
   * Opción 5: leads whose prompt fingerprint matches their latest stored
   * classification are skipped from the batch (and from token cost)
   * unless `force` is set, and their existing result is reused as-is.
   */
  async function classifyGroup(userId, leads, { force = false } = {}) {
    if (!aiClassifierClient.classifyMany) {
      // Provider doesn't support batching yet — let the caller fall back
      // to one-by-one classification.
      throw new AppError('Batch classification not supported by provider', 501);
    }

    const promptHashByLeadId = new Map();
    let leadsToClassify = leads;

    if (!force) {
      const reused = [];
      leadsToClassify = [];

      for (const lead of leads) {
        const { userPrompt } = buildClassificationPrompt(lead);
        const promptHash = hashClassificationPrompt(userPrompt);
        promptHashByLeadId.set(lead.id, promptHash);

        // eslint-disable-next-line no-await-in-loop -- small groups (BATCH_GROUP_SIZE), simplicity over micro-parallelism
        const latest = await classificationsRepository.findLatestByLeadId(lead.id, userId);
        if (latest && latest.prompt_hash === promptHash) {
          reused.push({ classification: latest, reused: true });
        } else {
          leadsToClassify.push(lead);
        }
      }

      if (leadsToClassify.length === 0) {
        return reused;
      }

      if (reused.length > 0) {
        return [...reused, ...(await classifyGroup(userId, leadsToClassify, { force: true }))];
      }
    }

    const leadIds = leadsToClassify.map((lead) => lead.id);

    // Opción 6: si alguno de los leads del grupo ya alcanzó el límite
    // diario de reclasificaciones, se corta antes de gastar tokens en el
    // batch (el caller — classifyBatch — cae a classifyOne por lead, que
    // vuelve a validar el límite y reporta el error individualmente).
    // `force` también saltea este límite, igual que en classifyOne.
    if (!force) {
      await Promise.all(
        leadsToClassify.map((lead) => assertReclassificationLimit(classificationsRepository, lead.id, userId))
      );
    }

    const { systemPrompt, userPrompt } = buildBatchClassificationPrompt(leadsToClassify);
    const result = await aiClassifierClient.classifyMany({
      systemPrompt,
      userPrompt,
      batchSize: leadsToClassify.length,
    });
    const parsedByLeadId = parseClassifierBatchOutput(result.parsedInput, leadIds);

    const totalTokens = result.inputTokens + result.outputTokens;
    const tokensPerLead = Math.round(totalTokens / leadsToClassify.length);

    const created = [];
    for (const leadId of leadIds) {
      created.push(
        // eslint-disable-next-line no-await-in-loop -- persisted sequentially to keep row order/id assignment deterministic
        {
          classification: await classificationsRepository.create({
            leadId,
            userId,
            ...parsedByLeadId.get(leadId),
            tokensUsed: tokensPerLead,
            modelUsed: model,
            promptHash: promptHashByLeadId.get(leadId) ?? null,
          }),
          reused: false,
        }
      );
    }

    return created;
  }

  return {
    classifyOne,

    /**
     * Real batching (docs/OPTIMIZACION_API_CLAUDE.md, item 4): groups
     * leadIds into chunks of `BATCH_GROUP_SIZE` and resolves each chunk
     * with a single `classifyMany` call instead of one Anthropic request
     * per lead. If a chunk's batch call fails (provider error, malformed
     * output, etc.) it falls back to classifying that chunk's leads
     * one-by-one, so a single bad batch never sinks leads that would
     * otherwise classify fine individually.
     */
    async classifyBatch(userId, leadIds, { force = false } = {}) {
      if (!Array.isArray(leadIds) || leadIds.length === 0) {
        throw new AppError('leadIds must be a non-empty array', 400);
      }

      const results = [];
      const errors = [];

      for (const idsChunk of chunk(leadIds, BATCH_GROUP_SIZE)) {
        const leads = await leadsRepository.findByIdsForUser(idsChunk, userId);
        const foundIds = new Set(leads.map((lead) => lead.id));

        for (const leadId of idsChunk) {
          if (!foundIds.has(leadId)) {
            errors.push({ leadId, error: 'Lead not found' });
          }
        }

        if (leads.length === 0) {
          continue;
        }

        try {
          const groupResults = await classifyGroup(userId, leads, { force });
          results.push(...groupResults.map(({ classification, reused }) => ({ ...classification, reused })));
        } catch (error) {
          console.error('[classificationsService] batch group failed, falling back to per-lead:', error);

          for (const lead of leads) {
            try {
              // eslint-disable-next-line no-await-in-loop -- sequential fallback avoids bursting the rate limit
              const { classification, reused } = await classifyOne(userId, lead.id, { force });
              results.push({ ...classification, reused });
            } catch (fallbackError) {
              errors.push({
                leadId: lead.id,
                error: fallbackError.message,
                ...(fallbackError.code ? { code: fallbackError.code } : {}),
              });
            }
          }
        }
      }

      return { classified: results.length, failed: errors.length, results, errors };
    },

    async getHistory(userId, leadId) {
      return classificationsRepository.findAllByLeadId(leadId, userId);
    },

    /**
     * Monitoreo de costos por uso de tokens (docs/OPTIMIZACION_API_CLAUDE.md,
     * opción 6): agrega `tokensUsed`/`modelUsed` ya guardados por día y por
     * lead para el usuario, dentro de una ventana de `days` días.
     */
    async getUsageReport(userId, { days = DEFAULT_USAGE_REPORT_DAYS } = {}) {
      const since = new Date(Date.now() - days * ONE_DAY_MS);

      const [totals, byDay, byLead] = await Promise.all([
        classificationsRepository.getUsageTotals(userId, since),
        classificationsRepository.getUsageByDay(userId, since),
        classificationsRepository.getUsageByLead(userId, since),
      ]);

      return {
        periodDays: days,
        since: since.toISOString(),
        model,
        totals: {
          classificationsCount: totals.classifications_count,
          tokensUsed: totals.tokens_used,
        },
        byDay: byDay.map((row) => ({
          day: row.day,
          classificationsCount: row.classifications_count,
          tokensUsed: row.tokens_used,
        })),
        byLead: byLead.map((row) => ({
          leadId: row.lead_id,
          classificationsCount: row.classifications_count,
          tokensUsed: row.tokens_used,
          lastClassifiedAt: row.last_classified_at,
        })),
      };
    },
  };
}


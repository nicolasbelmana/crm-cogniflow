import { AppError, NotFoundError } from '../../shared/errors/AppError.js';
import { estimateCostUsd, getAllModelPrices } from '../../shared/config/modelPrices.js';
import {
  buildClassificationPrompt,
  buildBatchClassificationPrompt,
  hashClassificationPrompt,
  buildClassificationCacheKey,
} from './classifications.prompt.js';
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
const CLOUD_PROVIDERS = new Set(['anthropic']);

function normalizeProviderForUsage(providerUsed) {
  const normalized = String(providerUsed ?? '').trim().toLowerCase();
  return normalized || 'unknown';
}

function sumUsageRows(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.classifications_count += Number(row.classifications_count ?? 0);
      acc.tokens_used += Number(row.tokens_used ?? 0);
      acc.input_tokens += Number(row.input_tokens ?? 0);
      acc.output_tokens += Number(row.output_tokens ?? 0);
      acc.estimated_cost_usd += Number(row.estimated_cost_usd ?? 0);
      return acc;
    },
    {
      classifications_count: 0,
      tokens_used: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
    }
  );
}

function groupUsageRowsByProvider(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const providerUsed = normalizeProviderForUsage(row.provider_used);
    const current = grouped.get(providerUsed) ?? {
      providerUsed,
      classificationsCount: 0,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    };

    current.classificationsCount += Number(row.classifications_count ?? 0);
    current.tokensUsed += Number(row.tokens_used ?? 0);
    current.inputTokens += Number(row.input_tokens ?? 0);
    current.outputTokens += Number(row.output_tokens ?? 0);
    current.estimatedCostUsd += Number(row.estimated_cost_usd ?? 0);

    grouped.set(providerUsed, current);
  }

  return Array.from(grouped.values()).sort((a, b) => a.providerUsed.localeCompare(b.providerUsed));
}

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
  defaultProvider,
  availableProviders = [],
  responseCache,
  monthlyTokenQuota = 10000,
}) {
  function resolveProviderMeta(providerName) {
    if (typeof aiClassifierClient.resolveProvider === 'function') {
      return aiClassifierClient.resolveProvider(providerName);
    }

    return {
      providerName: defaultProvider ?? 'default',
      modelUsed: model,
    };
  }

  async function classifyOne(userId, leadId, { force = false, provider } = {}) {
    const lead = await leadsRepository.findByIdForUser(leadId, userId);

    if (!lead) {
      throw new NotFoundError('Lead not found');
    }

  const { providerName, modelUsed } = resolveProviderMeta(provider);
    const { systemPrompt, userPrompt } = buildClassificationPrompt(lead);
    const promptHash = hashClassificationPrompt(userPrompt);
    const cacheKey = buildClassificationCacheKey({
      model: `${providerName}:${modelUsed}`,
      systemPrompt,
      userPrompt,
      lead,
    });

    if (!force && responseCache) {
      const cached = responseCache.get(cacheKey);
      if (cached?.classification) {
        return { classification: cached.classification, reused: true };
      }
    }

    // Opción 5 (docs/OPTIMIZACION_API_CLAUDE.md): if the lead's data hasn't
    // changed since its last classification (same prompt fingerprint),
    // skip the Anthropic call entirely and return the existing result.
    if (!force) {
      const latest = await classificationsRepository.findLatestByLeadId(leadId, userId);
      if (latest && latest.prompt_hash === promptHash) {
        if (responseCache) {
          responseCache.set(cacheKey, { classification: latest }, { estimatedTokens: latest.tokens_used ?? 0 });
        }

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

    const result = await aiClassifierClient.classify({ systemPrompt, userPrompt, provider });
    const effectiveProvider = result.providerUsed ?? providerName;
    const effectiveModel = result.modelUsed ?? modelUsed ?? model;
    const parsed = parseClassifierOutput(result.parsedInput);
    const inputTokens = result.inputTokens;
    const outputTokens = result.outputTokens;
    const totalTokens = inputTokens + outputTokens;
    const costs = estimateCostUsd({ model: effectiveModel, inputTokens, outputTokens });

    const classification = await classificationsRepository.create({
      leadId,
      userId,
      ...parsed,
      tokensUsed: totalTokens,
      modelUsed: effectiveModel,
      providerUsed: effectiveProvider,
      promptHash,
      inputTokens,
      outputTokens,
      estimatedCostUsd: costs.totalCostUsd,
    });

    if (responseCache) {
      responseCache.set(
        cacheKey,
        { classification },
        { estimatedTokens: totalTokens, estimatedCostUsd: costs.totalCostUsd }
      );
    }

    if (process.env.NODE_ENV !== 'production') {
      console.debug('[classificationsService] classification cost', {
    leadId,
  provider: effectiveProvider,
  model: effectiveModel,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd: costs.totalCostUsd,
      });
    }

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
  async function classifyGroup(userId, leads, { force = false, provider } = {}) {
    const { providerName, modelUsed } = resolveProviderMeta(provider);

    if (!aiClassifierClient.classifyMany) {
      // Provider doesn't support batching yet — let the caller fall back
      // to one-by-one classification.
      throw new AppError('Batch classification not supported by provider', 501);
    }

    const promptHashByLeadId = new Map();
    const cacheKeyByLeadId = new Map();
    const reused = [];
    const leadsToClassify = [];

    for (const lead of leads) {
      const { systemPrompt, userPrompt } = buildClassificationPrompt(lead);
      const promptHash = hashClassificationPrompt(userPrompt);
      const cacheKey = buildClassificationCacheKey({
        model: `${providerName}:${modelUsed}`,
        systemPrompt,
        userPrompt,
        lead,
      });

      promptHashByLeadId.set(lead.id, promptHash);
      cacheKeyByLeadId.set(lead.id, cacheKey);

      if (!force && responseCache) {
        const cached = responseCache.get(cacheKey);
        if (cached?.classification) {
          reused.push({ classification: cached.classification, reused: true });
          continue;
        }
      }

      if (!force) {
        // eslint-disable-next-line no-await-in-loop -- small groups (BATCH_GROUP_SIZE), simplicity over micro-parallelism
        const latest = await classificationsRepository.findLatestByLeadId(lead.id, userId);
        if (latest && latest.prompt_hash === promptHash) {
          reused.push({ classification: latest, reused: true });

          if (responseCache) {
            responseCache.set(cacheKey, { classification: latest }, { estimatedTokens: latest.tokens_used ?? 0 });
          }

          continue;
        }
      }

      leadsToClassify.push(lead);
    }

    if (leadsToClassify.length === 0) {
      return reused;
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
      provider,
    });
    const effectiveModel = result.modelUsed ?? modelUsed ?? model;
    const parsedByLeadId = parseClassifierBatchOutput(result.parsedInput, leadIds);

    const totalTokens = result.inputTokens + result.outputTokens;
    const tokensPerLead = Math.round(totalTokens / leadsToClassify.length);
    const inputTokensPerLead = Math.round(result.inputTokens / leadsToClassify.length);
    const outputTokensPerLead = Math.round(result.outputTokens / leadsToClassify.length);
    const costsPerLead = estimateCostUsd({
      model: effectiveModel,
      inputTokens: inputTokensPerLead,
      outputTokens: outputTokensPerLead,
    });

    const created = [];
    for (const leadId of leadIds) {
      const classification =
        // eslint-disable-next-line no-await-in-loop -- persisted sequentially to keep row order/id assignment deterministic
        await classificationsRepository.create({
          leadId,
          userId,
          ...parsedByLeadId.get(leadId),
          tokensUsed: tokensPerLead,
          modelUsed: effectiveModel,
          providerUsed: result.providerUsed ?? providerName,
          promptHash: promptHashByLeadId.get(leadId) ?? null,
          inputTokens: inputTokensPerLead,
          outputTokens: outputTokensPerLead,
          estimatedCostUsd: costsPerLead.totalCostUsd,
        });

      if (responseCache) {
        responseCache.set(
          cacheKeyByLeadId.get(leadId),
          { classification },
          { estimatedTokens: tokensPerLead, estimatedCostUsd: costsPerLead.totalCostUsd }
        );
      }

      created.push(
        {
          classification,
          reused: false,
        }
      );
    }

    return [...reused, ...created];
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
    async classifyBatch(userId, leadIds, { force = false, provider } = {}) {
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
          const groupResults = await classifyGroup(userId, leads, { force, provider });
          results.push(...groupResults.map(({ classification, reused }) => ({ ...classification, reused })));
        } catch (error) {
          console.error('[classificationsService] batch group failed, falling back to per-lead:', error);

          for (const lead of leads) {
            try {
              // eslint-disable-next-line no-await-in-loop -- sequential fallback avoids bursting the rate limit
              const { classification, reused } = await classifyOne(userId, lead.id, { force, provider });
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

      const [totals, byDay, byLead, byDayModel, monthTotals] = await Promise.all([
        classificationsRepository.getUsageTotals(userId, since),
        classificationsRepository.getUsageByDay(userId, since),
        classificationsRepository.getUsageByLead(userId, since),
        classificationsRepository.getUsageByDayAndModel(userId, since),
        classificationsRepository.getCurrentMonthUsageTotals(userId),
      ]);

      const totalsRows = Array.isArray(totals) ? totals : [totals].filter(Boolean);
      const monthTotalsRows = Array.isArray(monthTotals) ? monthTotals : [monthTotals].filter(Boolean);
      const aggregatedTotals = sumUsageRows(totalsRows);
      const totalsByProvider = groupUsageRowsByProvider(totalsRows);
      const monthByProvider = groupUsageRowsByProvider(monthTotalsRows);
      const hasProviderScopedMonthRows = monthTotalsRows.some((row) => row?.provider_used != null);

      const cloudMonth = hasProviderScopedMonthRows
        ? monthByProvider
            .filter((row) => CLOUD_PROVIDERS.has(row.providerUsed))
            .reduce(
              (acc, row) => {
                acc.tokensUsed += Number(row.tokensUsed ?? 0);
                acc.classificationsCount += Number(row.classificationsCount ?? 0);
                acc.estimatedCostUsd += Number(row.estimatedCostUsd ?? 0);
                return acc;
              },
              { tokensUsed: 0, classificationsCount: 0, estimatedCostUsd: 0 }
            )
        : {
            tokensUsed: monthTotalsRows.reduce((acc, row) => acc + Number(row?.tokens_used ?? 0), 0),
            classificationsCount: monthTotalsRows.reduce(
              (acc, row) => acc + Number(row?.classifications_count ?? 0),
              0
            ),
            estimatedCostUsd: monthTotalsRows.reduce(
              (acc, row) => acc + Number(row?.estimated_cost_usd ?? 0),
              0
            ),
          };

      const cacheStats = responseCache?.getStats?.() ?? null;
      const quotaUsedTokens = Number(cloudMonth.tokensUsed ?? 0);
      const quotaLimitTokens = Number(monthlyTokenQuota);
      const quotaUsedPct = quotaLimitTokens > 0 ? Math.min(100, (quotaUsedTokens / quotaLimitTokens) * 100) : 0;

      return {
        periodDays: days,
        since: since.toISOString(),
    provider: defaultProvider,
    availableProviders,
    model,
        pricing: {
          models: getAllModelPrices(),
        },
        totals: {
          classificationsCount: aggregatedTotals.classifications_count,
          tokensUsed: aggregatedTotals.tokens_used,
          inputTokens: aggregatedTotals.input_tokens,
          outputTokens: aggregatedTotals.output_tokens,
          estimatedCostUsd: Number(aggregatedTotals.estimated_cost_usd ?? 0),
          averageTokens:
            Number(aggregatedTotals.classifications_count) > 0
              ? Number(aggregatedTotals.tokens_used) / Number(aggregatedTotals.classifications_count)
              : 0,
          averageCostUsd:
            Number(aggregatedTotals.classifications_count) > 0
              ? Number(aggregatedTotals.estimated_cost_usd ?? 0) / Number(aggregatedTotals.classifications_count)
              : 0,
        },
        totalsByProvider,
        byDay: byDay.map((row) => ({
          day: row.day,
          providerUsed: normalizeProviderForUsage(row.provider_used),
          classificationsCount: row.classifications_count,
          tokensUsed: row.tokens_used,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
        })),
        byDayModel: byDayModel.map((row) => ({
          day: row.day,
          modelUsed: row.model_used,
          providerUsed: normalizeProviderForUsage(row.provider_used),
          calls: row.calls_count,
          tokensUsed: row.tokens_used,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
        })),
        byLead: byLead.map((row) => ({
          leadId: row.lead_id,
          classificationsCount: row.classifications_count,
          tokensUsed: row.tokens_used,
          estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
          lastClassifiedAt: row.last_classified_at,
        })),
        quota: {
          monthlyTokenQuota: quotaLimitTokens,
          usedTokens: quotaUsedTokens,
          remainingTokens: Math.max(0, quotaLimitTokens - quotaUsedTokens),
          usedPct: quotaUsedPct,
          overQuota: quotaUsedTokens > quotaLimitTokens,
          decision: quotaUsedTokens > quotaLimitTokens ? 'allow_with_warning' : 'within_quota',
          providerScope: 'cloud-only',
          cloudProviders: Array.from(CLOUD_PROVIDERS),
        },
        cache: cacheStats,
        stats: {
          total_calls: Number(aggregatedTotals.classifications_count),
          cached_calls: Number(cacheStats?.cache_hit ?? 0),
          saved_calls: Number(cacheStats?.cache_saved_calls ?? 0),
          saved_tokens: Number(cacheStats?.cache_saved_tokens ?? 0),
          saved_usd: Number(cacheStats?.cache_saved_usd ?? 0),
          average_cost: Number(aggregatedTotals.classifications_count) > 0
            ? Number(aggregatedTotals.estimated_cost_usd ?? 0) / Number(aggregatedTotals.classifications_count)
            : 0,
          average_tokens: Number(aggregatedTotals.classifications_count) > 0
            ? Number(aggregatedTotals.tokens_used) / Number(aggregatedTotals.classifications_count)
            : 0,
        },
      };
    },
  };
}


import test from 'node:test';
import assert from 'node:assert/strict';
import { createClassificationsService } from '../src/modules/classifications/classifications.service.js';
import { createResponseCache } from '../src/shared/cache/responseCache.js';

function buildLead(id = 'lead-1') {
  return {
    id,
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '123',
    company: 'Acme',
    source: 'manual',
    chat_history: [{ role: 'client', text: 'Necesito una demo cuanto antes' }],
    raw_data: {},
  };
}

test('classifyOne reuses cache on second call and avoids second AI request', async () => {
  const lead = buildLead();
  let aiCalls = 0;

  const leadsRepository = {
    async findByIdForUser() {
      return lead;
    },
  };

  const classificationsRepository = {
    async findLatestByLeadId() {
      return null;
    },
    async countByLeadIdSince() {
      return 0;
    },
    async create(payload) {
      return {
        id: 'classification-1',
        lead_id: payload.leadId,
        user_id: payload.userId,
        temperature: payload.temperature,
        confidence: payload.confidence,
        reasoning: payload.reasoning,
        tokens_used: payload.tokensUsed,
        model_used: payload.modelUsed,
        prompt_hash: payload.promptHash,
        input_tokens: payload.inputTokens,
        output_tokens: payload.outputTokens,
        estimated_cost_usd: payload.estimatedCostUsd,
      };
    },
  };

  const aiClassifierClient = {
    async classify() {
      aiCalls += 1;
      return {
        parsedInput: { temperature: 'hot', confidence: 0.95, reasoning: 'Alta intención de compra inmediata.' },
        inputTokens: 100,
        outputTokens: 50,
      };
    },
  };

  const responseCache = createResponseCache({ enabled: true, ttlSeconds: 3600 });

  const service = createClassificationsService({
    leadsRepository,
    classificationsRepository,
    aiClassifierClient,
    model: 'claude-haiku-4-5',
    responseCache,
    monthlyTokenQuota: 10000,
  });

  const first = await service.classifyOne('user-1', lead.id);
  const second = await service.classifyOne('user-1', lead.id);

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(aiCalls, 1);

  const cacheStats = responseCache.getStats();
  assert.equal(cacheStats.cache_hit, 1);
  assert.equal(cacheStats.cache_saved_calls, 1);
});

test('getUsageReport includes quota and stats fields', async () => {
  const service = createClassificationsService({
    leadsRepository: {},
    classificationsRepository: {
      async getUsageTotals() {
        return {
          classifications_count: 4,
          tokens_used: 1200,
          input_tokens: 900,
          output_tokens: 300,
          estimated_cost_usd: '0.012',
        };
      },
      async getUsageByDay() {
        return [
          {
            day: '2026-08-01',
            classifications_count: 2,
            tokens_used: 600,
            input_tokens: 450,
            output_tokens: 150,
            estimated_cost_usd: '0.006',
          },
        ];
      },
      async getUsageByLead() {
        return [
          {
            lead_id: 'lead-1',
            classifications_count: 2,
            tokens_used: 600,
            estimated_cost_usd: '0.006',
            last_classified_at: new Date().toISOString(),
          },
        ];
      },
      async getUsageByDayAndModel() {
        return [
          {
            day: '2026-08-01',
            model_used: 'claude-haiku-4-5',
            calls_count: 2,
            tokens_used: 600,
            input_tokens: 450,
            output_tokens: 150,
            estimated_cost_usd: '0.006',
          },
        ];
      },
      async getCurrentMonthUsageTotals() {
        return {
          classifications_count: 10,
          tokens_used: 1200,
          estimated_cost_usd: '0.012',
        };
      },
    },
    aiClassifierClient: {},
    model: 'claude-haiku-4-5',
    responseCache: createResponseCache({ enabled: true, ttlSeconds: 60 }),
    monthlyTokenQuota: 1000,
  });

  const usage = await service.getUsageReport('user-1', { days: 30 });

  assert.equal(usage.totals.classificationsCount, 4);
  assert.equal(usage.quota.usedTokens, 1200);
  assert.equal(usage.quota.overQuota, true);
  assert.equal(usage.stats.total_calls, 4);
  assert.equal(Array.isArray(usage.byDayModel), true);
});

test('classifyBatch processes leadIds in groups of 5', async () => {
  const leadIds = Array.from({ length: 11 }, (_, index) => `lead-${index + 1}`);
  const leadsById = new Map(leadIds.map((id) => [id, buildLead(id)]));

  const requestedChunks = [];
  const batchSizes = [];

  const leadsRepository = {
    async findByIdsForUser(idsChunk) {
      requestedChunks.push(idsChunk);
      return idsChunk.map((id) => leadsById.get(id));
    },
  };

  const classificationsRepository = {
    async findLatestByLeadId() {
      return null;
    },
    async countByLeadIdSince() {
      return 0;
    },
    async create(payload) {
      return {
        id: `classification-${payload.leadId}`,
        lead_id: payload.leadId,
        user_id: payload.userId,
        temperature: payload.temperature,
        confidence: payload.confidence,
        reasoning: payload.reasoning,
        tokens_used: payload.tokensUsed,
        model_used: payload.modelUsed,
        prompt_hash: payload.promptHash,
        input_tokens: payload.inputTokens,
        output_tokens: payload.outputTokens,
        estimated_cost_usd: payload.estimatedCostUsd,
      };
    },
  };

  const aiClassifierClient = {
    async classifyMany({ batchSize, userPrompt }) {
      batchSizes.push(batchSize);
      const leadIdMatches = [...userPrompt.matchAll(/id:([\w-]+)/g)];
      const idsInPrompt = leadIdMatches.map((match) => match[1]);

      return {
        parsedInput: {
          classifications: idsInPrompt.map((leadId) => ({
            leadId,
            temperature: 'warm',
            confidence: 0.8,
            reasoning: 'Interés moderado detectado.',
          })),
        },
        inputTokens: 100,
        outputTokens: 50,
      };
    },
  };

  const service = createClassificationsService({
    leadsRepository,
    classificationsRepository,
    aiClassifierClient,
    model: 'claude-haiku-4-5',
    responseCache: createResponseCache({ enabled: false, ttlSeconds: 60 }),
    monthlyTokenQuota: 10000,
  });

  const result = await service.classifyBatch('user-1', leadIds);

  assert.equal(result.classified, 11);
  assert.equal(result.failed, 0);
  assert.deepEqual(batchSizes, [5, 5, 1]);
  assert.deepEqual(requestedChunks.map((chunk) => chunk.length), [5, 5, 1]);
});

import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '../errors/AppError.js';

/**
 * Forces Claude to answer through a "tool call" instead of free text. This
 * is Anthropic's equivalent of OpenAI's Structured Outputs (see
 * docs/cogniflow_spec_tecnico.md section 7): the model MUST call this tool
 * with arguments matching the schema, so we get a reliable object back
 * instead of parsing loose JSON out of a text response.
 */
const CLASSIFY_TOOL = {
  name: 'classify_lead',
  description: 'Registra la clasificación de temperatura de venta de un lead.',
  input_schema: {
    type: 'object',
    properties: {
      temperature: { type: 'string', enum: ['cold', 'warm', 'hot'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      // Shortened from 200 to 120 (docs/OPTIMIZACION_API_CLAUDE.md, item 2):
      // the frontend (Leads.jsx) already truncates this cell visually
      // (`max-w-xs`), so a long reasoning brings no UX benefit — only
      // extra output tokens billed at a higher rate than input tokens.
      reasoning: { type: 'string', maxLength: 120 },
    },
    required: ['temperature', 'confidence', 'reasoning'],
  },
  // Marks this tool definition as cacheable. It's static across every
  // request, so Anthropic can reuse the cached version instead of
  // re-processing/re-billing it at full price each call (see
  // docs/OPTIMIZACION_API_CLAUDE.md, item 1).
  cache_control: { type: 'ephemeral' },
};

/**
 * Batch counterpart of CLASSIFY_TOOL (docs/OPTIMIZACION_API_CLAUDE.md,
 * item 4): a single tool call that returns an array of classifications,
 * one per requested `leadId`, instead of one tool call per lead.
 */
const CLASSIFY_LEADS_TOOL = {
  name: 'classify_leads',
  description: 'Registra la clasificación de temperatura de venta para varios leads en una sola llamada.',
  input_schema: {
    type: 'object',
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            leadId: { type: 'string' },
            temperature: { type: 'string', enum: ['cold', 'warm', 'hot'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            reasoning: { type: 'string', maxLength: 120 },
          },
          required: ['leadId', 'temperature', 'confidence', 'reasoning'],
        },
      },
    },
    required: ['classifications'],
  },
  cache_control: { type: 'ephemeral' },
};

// Base per-lead token budget (mirrors CLASSIFY_TOOL's single-lead
// max_tokens) plus a small fixed overhead for the wrapping array/object.
const PER_LEAD_MAX_TOKENS = 160;
const BATCH_MAX_TOKENS_OVERHEAD = 40;

/**
 * Concrete implementation of the aiClassifierClient contract using
 * Anthropic's Claude. Receives `apiKey`/`model` as parameters (instead of
 * reading `config` itself) so it stays swappable/testable, consistent with
 * how `createTokenService`/`createLeadsRepository` take their dependencies
 * by parameter rather than importing globals.
 */
export function createAnthropicClassifierClient({ apiKey, model }) {
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required to create the Anthropic classifier client');
  }

  const client = new Anthropic({ apiKey });

  return {
    async classify({ systemPrompt, userPrompt }) {
      let response;

      try {
        response = await client.messages.create({
          model,
          // Lowered from 300 to 160 (docs/OPTIMIZACION_API_CLAUDE.md, item 2):
          // enough headroom for temperature + confidence + a ~120-char
          // reasoning string as tool_use JSON, without paying for unused
          // output token budget.
          max_tokens: 160,
          // The system prompt is wrapped as a content block (instead of a
          // plain string) so we can attach `cache_control`. It's identical
          // on every call, so Anthropic caches it after the first request
          // and reuses it at a fraction of the input-token cost for
          // subsequent calls within the ~5 min cache window (important
          // for classifyBatch, which calls this sequentially per lead).
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: userPrompt }],
          tools: [CLASSIFY_TOOL],
          tool_choice: { type: 'tool', name: 'classify_lead' },
        });
      } catch (error) {
        // Never leak the raw SDK/network error to HTTP clients — log it
        // server-side (picked up by the central errorHandler) and surface
        // a generic, safe 502 instead.
        console.error('[anthropicClassifierClient] request failed:', error);
        throw new AppError('Classification provider unavailable', 502);
      }

      const toolUse = response.content.find((block) => block.type === 'tool_use');

      // Cache diagnostics: cache_read_input_tokens > 0 confirms the cached
      // system/tool blocks were reused (billed ~10% of normal input price);
      // cache_creation_input_tokens > 0 means this call wrote the cache
      // (billed ~25% extra, only on the first call within the window).
      if (response.usage?.cache_read_input_tokens || response.usage?.cache_creation_input_tokens) {
        console.debug('[anthropicClassifierClient] cache usage:', {
          cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
        });
      }

      return {
        parsedInput: toolUse?.input ?? null,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };
    },

    /**
     * Real batching (docs/OPTIMIZACION_API_CLAUDE.md, item 4): sends up to
     * N leads packed into a single `userPrompt` and forces one
     * `classify_leads` tool call that returns an array of results, instead
     * of N separate requests each paying the fixed system/tool-schema
     * overhead. `batchSize` only sizes `max_tokens`; the actual number of
     * leads is implicit in the prompt built by
     * `buildBatchClassificationPrompt`.
     */
    async classifyMany({ systemPrompt, userPrompt, batchSize }) {
      let response;

      try {
        response = await client.messages.create({
          model,
          max_tokens: PER_LEAD_MAX_TOKENS * Math.max(1, batchSize ?? 1) + BATCH_MAX_TOKENS_OVERHEAD,
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: userPrompt }],
          tools: [CLASSIFY_LEADS_TOOL],
          tool_choice: { type: 'tool', name: 'classify_leads' },
        });
      } catch (error) {
        console.error('[anthropicClassifierClient] batch request failed:', error);
        throw new AppError('Classification provider unavailable', 502);
      }

      const toolUse = response.content.find((block) => block.type === 'tool_use');

      if (response.usage?.cache_read_input_tokens || response.usage?.cache_creation_input_tokens) {
        console.debug('[anthropicClassifierClient] batch cache usage:', {
          cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
        });
      }

      return {
        parsedInput: toolUse?.input ?? null,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };
    },
  };
}

import { AppError } from '../errors/AppError.js';

const SINGLE_CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    temperature: {
      type: 'string',
      enum: ['cold', 'warm', 'hot'],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    reasoning: {
      type: 'string',
    },
  },
  required: ['temperature', 'confidence', 'reasoning'],
};

const BATCH_CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          temperature: {
            type: 'string',
            enum: ['cold', 'warm', 'hot'],
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },
          reasoning: { type: 'string' },
        },
        required: ['leadId', 'temperature', 'confidence', 'reasoning'],
      },
    },
  },
  required: ['classifications'],
};

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }

  const direct = safeJsonParse(text);
  if (direct) {
    return direct;
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return safeJsonParse(text.slice(firstBrace, lastBrace + 1));
}

function normalizeTemperature(rawTemperature) {
  const value = String(rawTemperature ?? '').trim().toLowerCase();

  if (['cold', 'frio', 'frío'].includes(value)) {
    return 'cold';
  }

  if (['warm', 'tibio', 'templado'].includes(value)) {
    return 'warm';
  }

  if (['hot', 'caliente'].includes(value)) {
    return 'hot';
  }

  return rawTemperature;
}

function normalizeSingleClassification(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const source = payload.classification && typeof payload.classification === 'object'
    ? payload.classification
    : payload;

  const temperature = normalizeTemperature(source.temperature ?? source.temperatura ?? source.temp);
  const rawConfidence = source.confidence ?? source.confianza ?? source.score;
  const confidenceNumber = Number(rawConfidence);
  const confidence =
    Number.isFinite(confidenceNumber) && confidenceNumber > 1 && confidenceNumber <= 100
      ? confidenceNumber / 100
      : rawConfidence;
  const reasoning = source.reasoning ?? source.razonamiento ?? source.reason ?? source.motivo;

  return {
    ...source,
    temperature,
    confidence,
    reasoning,
  };
}

function normalizeBatchClassification(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const rawItems = Array.isArray(payload.classifications)
    ? payload.classifications
    : Array.isArray(payload.results)
      ? payload.results
      : Array.isArray(payload.items)
        ? payload.items
        : null;

  if (!rawItems) {
    return normalizeSingleClassification(payload);
  }

  return {
    ...payload,
    classifications: rawItems.map((item) => {
      const normalized = normalizeSingleClassification(item);
      return {
        ...normalized,
        leadId: item?.leadId ?? item?.lead_id ?? item?.id,
      };
    }),
  };
}

function mapOllamaErrorStatus(status, { model, baseUrl }) {
  if (status === 404) {
    return new AppError(
      `Ollama model '${model}' not found on ${baseUrl}. Pull that model or change OLLAMA_MODEL.`,
      502
    );
  }

  if (status === 408 || status === 504) {
    return new AppError('Ollama provider timeout', 504);
  }

  return new AppError('Classification provider unavailable', 502);
}

async function invokeOllamaChat({ baseUrl, model, systemPrompt, userPrompt, timeoutMs, format = 'json' }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: false,
        format,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
  throw mapOllamaErrorStatus(response.status, { model, baseUrl });
    }

    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AppError('Ollama provider timeout', 504);
    }

    if (error instanceof AppError) {
      throw error;
    }

    console.error('[ollamaClassifierClient] request failed:', error);
    throw new AppError('Classification provider unavailable', 502);
  } finally {
    clearTimeout(timeout);
  }
}

function extractTokenUsage(responseBody) {
  return {
    inputTokens: Number(responseBody?.prompt_eval_count ?? 0),
    outputTokens: Number(responseBody?.eval_count ?? 0),
  };
}

export function createOllamaClassifierClient({ baseUrl, model, timeoutMs = 30000 }) {
  return {
    async classify({ systemPrompt, userPrompt }) {
      const responseBody = await invokeOllamaChat({
        baseUrl,
        model,
        systemPrompt,
        userPrompt,
        timeoutMs,
        format: SINGLE_CLASSIFICATION_SCHEMA,
      });

      const parsedInput = normalizeSingleClassification(
        extractFirstJsonObject(responseBody?.message?.content ?? '')
      );
      const { inputTokens, outputTokens } = extractTokenUsage(responseBody);

      return {
        parsedInput,
        inputTokens,
        outputTokens,
      };
    },

    async classifyMany({ systemPrompt, userPrompt }) {
      const responseBody = await invokeOllamaChat({
        baseUrl,
        model,
        systemPrompt,
        userPrompt,
        timeoutMs,
        format: BATCH_CLASSIFICATION_SCHEMA,
      });

      const parsedInput = normalizeBatchClassification(
        extractFirstJsonObject(responseBody?.message?.content ?? '')
      );
      const { inputTokens, outputTokens } = extractTokenUsage(responseBody);

      return {
        parsedInput,
        inputTokens,
        outputTokens,
      };
    },
  };
}

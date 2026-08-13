import { AppError } from '../errors/AppError.js';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const SINGLE_MAX_OUTPUT_TOKENS = 220;
const PER_LEAD_MAX_OUTPUT_TOKENS = 180;
const BATCH_MAX_OUTPUT_OVERHEAD = 60;

const SINGLE_CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    temperature: { type: 'string', enum: ['cold', 'warm', 'hot'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string' },
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
          temperature: { type: 'string', enum: ['cold', 'warm', 'hot'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
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

function normalizeGeminiModel(model) {
  return String(model ?? 'gemini-2.5-flash').replace(/^models\//, '');
}

function extractTokenUsage(responseBody) {
  return {
    inputTokens: Number(responseBody?.usageMetadata?.promptTokenCount ?? 0),
    outputTokens: Number(responseBody?.usageMetadata?.candidatesTokenCount ?? 0),
  };
}

function mapGeminiStatus(status, details, model) {
  if (status === 401 || status === 403) {
    return new AppError('Gemini authentication failed. Check GEMINI_API_KEY.', 502);
  }

  if (status === 404) {
    return new AppError(`Gemini model '${model}' not found. Check GEMINI_MODEL.`, 502);
  }

  if (status === 429) {
    return new AppError('Gemini rate limit exceeded. Retry in a moment.', 429);
  }

  if (status === 408 || status === 504 || status === 503) {
    return new AppError('Gemini provider timeout', 504);
  }

  return new AppError(`Classification provider unavailable${details ? `: ${details}` : ''}`, 502);
}

async function invokeGemini({ apiKey, model, systemPrompt, userPrompt, timeoutMs, responseSchema, maxOutputTokens }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const normalizedModel = normalizeGeminiModel(model);
  const endpoint = `${GEMINI_BASE_URL}/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topP: 0.95,
          maxOutputTokens,
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    const responseJson = safeJsonParse(responseText) ?? {};

    if (!response.ok) {
      const details = responseJson?.error?.message ?? null;
      throw mapGeminiStatus(response.status, details, normalizedModel);
    }

    return responseJson;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AppError('Gemini provider timeout', 504);
    }

    if (error instanceof AppError) {
      throw error;
    }

    console.error('[geminiClassifierClient] request failed:', error);
    throw new AppError('Classification provider unavailable', 502);
  } finally {
    clearTimeout(timeout);
  }
}

function extractResponseText(responseBody) {
  const parts = responseBody?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  const textPart = parts.find((part) => typeof part?.text === 'string');
  return textPart?.text ?? '';
}

export function createGeminiClassifierClient({ apiKey, model, timeoutMs = 30000 }) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to create the Gemini classifier client');
  }

  return {
    async classify({ systemPrompt, userPrompt }) {
      const responseBody = await invokeGemini({
        apiKey,
        model,
        systemPrompt,
        userPrompt,
        timeoutMs,
        responseSchema: SINGLE_CLASSIFICATION_SCHEMA,
        maxOutputTokens: SINGLE_MAX_OUTPUT_TOKENS,
      });

      const parsedInput = extractFirstJsonObject(extractResponseText(responseBody));
      if (!parsedInput) {
        throw new AppError('Gemini returned invalid classification payload', 502);
      }

      const { inputTokens, outputTokens } = extractTokenUsage(responseBody);
      return {
        parsedInput,
        inputTokens,
        outputTokens,
      };
    },

    async classifyMany({ systemPrompt, userPrompt, batchSize }) {
      const responseBody = await invokeGemini({
        apiKey,
        model,
        systemPrompt,
        userPrompt,
        timeoutMs,
        responseSchema: BATCH_CLASSIFICATION_SCHEMA,
        maxOutputTokens: PER_LEAD_MAX_OUTPUT_TOKENS * Math.max(1, batchSize ?? 1) + BATCH_MAX_OUTPUT_OVERHEAD,
      });

      const parsedInput = extractFirstJsonObject(extractResponseText(responseBody));
      if (!parsedInput) {
        throw new AppError('Gemini returned invalid batch classification payload', 502);
      }

      const { inputTokens, outputTokens } = extractTokenUsage(responseBody);
      return {
        parsedInput,
        inputTokens,
        outputTokens,
      };
    },
  };
}

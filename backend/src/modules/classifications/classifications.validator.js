import { AppError } from '../../shared/errors/AppError.js';

const VALID_TEMPERATURES = new Set(['cold', 'warm', 'hot']);

/**
 * Defense-in-depth: even though Anthropic's forced tool-use should already
 * guarantee this shape, we never trust an external provider's output
 * blindly before persisting it — same philosophy as validating HTTP input
 * everywhere else in the backend.
 */
export function parseClassifierOutput(parsedInput) {
  if (!parsedInput || !VALID_TEMPERATURES.has(parsedInput.temperature)) {
    throw new AppError('AI provider returned an invalid classification', 502);
  }

  const confidence = Number(parsedInput.confidence);
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    throw new AppError('AI provider returned an invalid confidence score', 502);
  }

  return {
    temperature: parsedInput.temperature,
    confidence,
    // Kept in sync with the tool schema's maxLength: 120
    // (docs/OPTIMIZACION_API_CLAUDE.md, item 2). The DB column
    // (VARCHAR(300)) still has extra headroom, that's fine.
    reasoning: String(parsedInput.reasoning ?? '').slice(0, 120),
  };
}

/**
 * Validates the output of `classify_leads` (batching, item 4): the
 * provider must return exactly one classification per requested
 * `leadId`, no extras, no duplicates, no invented ids. Returns a
 * `Map<leadId, parsedClassification>` for O(1) lookup by the service.
 */
export function parseClassifierBatchOutput(parsedInput, expectedLeadIds) {
  if (!parsedInput || !Array.isArray(parsedInput.classifications)) {
    throw new AppError('AI provider returned an invalid batch classification', 502);
  }

  const expected = new Set(expectedLeadIds);
  const byLeadId = new Map();

  for (const item of parsedInput.classifications) {
    if (!item || typeof item.leadId !== 'string' || !expected.has(item.leadId)) {
      throw new AppError('AI provider returned an unknown leadId in batch classification', 502);
    }

    if (byLeadId.has(item.leadId)) {
      throw new AppError('AI provider returned a duplicate leadId in batch classification', 502);
    }

    byLeadId.set(item.leadId, parseClassifierOutput(item));
  }

  if (byLeadId.size !== expected.size) {
    throw new AppError('AI provider did not return a classification for every lead', 502);
  }

  return byLeadId;
}

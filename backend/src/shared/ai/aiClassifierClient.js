/**
 * @typedef {Object} ClassifierResult
 * @property {Object|null} parsedInput - structured object already parsed
 *   from the provider's response (no fragile text-JSON parsing needed by
 *   callers).
 * @property {number} inputTokens
 * @property {number} outputTokens
 */

/**
 * Contract that `classifications.service.js` depends on. It knows nothing
 * about Anthropic, OpenAI or Ollama — just "give me a classification for
 * this prompt". Concrete providers (see anthropicClassifierClient.js)
 * implement this shape and get wired in app.js (Dependency Inversion,
 * same pattern as shared/security/passwordHasher.js).
 *
 * @param {{ systemPrompt: string, userPrompt: string }} params
 * @returns {Promise<ClassifierResult>}
 */
export function createAiClassifierClientContract() {
  throw new Error('This is a documentation-only contract, not meant to be instantiated.');
}

/**
 * Batch counterpart of `classify` (docs/OPTIMIZACION_API_CLAUDE.md, item
 * 4). Providers implementing this contract must return, in `parsedInput`,
 * an object with a `classifications` array — one entry per `leadId` sent
 * in the batch prompt — instead of a single classification.
 *
 * @param {{ systemPrompt: string, userPrompt: string, batchSize?: number }} params
 * @returns {Promise<ClassifierResult>}
 */
export function createAiClassifierClientBatchContract() {
  throw new Error('This is a documentation-only contract, not meant to be instantiated.');
}

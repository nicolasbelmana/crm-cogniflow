/**
 * @typedef {Object} ProviderClassifyInput
 * @property {string} systemPrompt
 * @property {string} userPrompt
 * @property {number} [batchSize]
 */

/**
 * @typedef {Object} ProviderClassifyOutput
 * @property {Object|null} parsedInput
 * @property {number} inputTokens
 * @property {number} outputTokens
 */

/**
 * Shared provider function signature.
 *
 * Every provider implementation (cloud and Ollama) must expose this exact
 * callable shape so the rest of the app stays provider-agnostic.
 *
 * @param {ProviderClassifyInput} params
 * @returns {Promise<ProviderClassifyOutput>}
 */
export function classifyWithProviderContract() {
  throw new Error('This is a documentation-only contract, not meant to be instantiated.');
}

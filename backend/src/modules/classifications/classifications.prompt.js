import { createHash } from 'crypto';

const SYSTEM_PROMPT = `Eres un experto en ventas. Clasificás leads por temperatura:
- cold: sin interés, primer contacto.
- warm: mostró interés, posible cliente.
- hot: listo para comprar, urgencia alta.
Sé breve y preciso.`;

/**
 * Cost-optimization strategy from docs/cogniflow_spec_tecnico.md (section
 * 5): compress `chat_history` into a single compact line instead of
 * sending the full conversation. `chat_history` is already capped to the
 * last 5 entries by leads.validator.js; here we take just the last 2 and
 * flatten them into one line, truncating each entry to ~80 chars to
 * further reduce `userPrompt` token usage (see docs/OPTIMIZACION_API_CLAUDE.md,
 * opción 3).
 */
const MAX_HISTORY_ENTRIES = 2;
const MAX_ENTRY_LENGTH = 80;

function summarizeChatHistory(chatHistory) {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
    return 'sin msjs previos';
  }

  const summary = chatHistory
    .slice(-MAX_HISTORY_ENTRIES)
    .map((entry) => (typeof entry === 'string' ? entry : entry?.text))
    .filter(Boolean)
    .map((text) => text.slice(0, MAX_ENTRY_LENGTH))
    .join(' / ');

  return summary || 'sin msjs previos';
}

/**
 * Builds the optimized system+user prompt pair for a given lead. Pure
 * function, no I/O — easy to unit test and to tweak wording without
 * touching the service/AI client.
 */
export function buildClassificationPrompt(lead) {
  const chatSummary = summarizeChatHistory(lead.chat_history);

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Lead: ${lead.name} | ${lead.company} | últ. msjs: ${chatSummary}`,
  };
}

/**
 * Deterministic fingerprint of a lead's classification `userPrompt`
 * (docs/OPTIMIZACION_API_CLAUDE.md, opción 5): if a lead's prompt hasn't
 * changed since its last classification, classifications.service.js can
 * skip the Anthropic call entirely and reuse the stored result.
 */
export function hashClassificationPrompt(userPrompt) {
  return createHash('sha256').update(userPrompt).digest('hex');
}

const BATCH_SYSTEM_PROMPT = `${SYSTEM_PROMPT}
Vas a recibir varios leads en un solo mensaje, cada uno con su "id". Devolvé una
clasificación por cada id recibido, repitiendo el mismo id en la respuesta, sin
omitir ninguno y sin inventar ids nuevos.`;

/**
 * Real batching (docs/OPTIMIZACION_API_CLAUDE.md, item 4): instead of one
 * prompt/tool-call per lead, packs up to N leads into a single
 * system+user prompt pair so `anthropicClassifierClient.classifyMany` can
 * resolve them all in one Anthropic request, cutting the fixed per-request
 * overhead (system prompt, tool schema, etc.) by the batch size.
 */
export function buildBatchClassificationPrompt(leads) {
  const lines = leads.map((lead) => {
    const chatSummary = summarizeChatHistory(lead.chat_history);
    return `- id:${lead.id} | ${lead.name} | ${lead.company} | últ. msjs: ${chatSummary}`;
  });

  return {
    systemPrompt: BATCH_SYSTEM_PROMPT,
    userPrompt: `Clasificá cada uno de estos ${leads.length} leads (repetí el id exacto en cada resultado):\n${lines.join('\n')}`,
  };
}

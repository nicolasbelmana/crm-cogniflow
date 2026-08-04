import dotenv from 'dotenv';

dotenv.config();

function parsePositiveIntEnv(value, defaultValue) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export const ollamaConfig = {
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL || 'llama3.2:1b',
  timeoutMs: parsePositiveIntEnv(process.env.OLLAMA_TIMEOUT_MS, 30000),
};

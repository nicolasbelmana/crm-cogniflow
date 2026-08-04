import dotenv from 'dotenv';
import { ollamaConfig } from './ollama.js';

dotenv.config();

function parseBooleanEnv(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  return value.toLowerCase() === 'true';
}

function parsePositiveIntEnv(value, defaultValue) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  ai: {
    provider: process.env.AI_PROVIDER || 'anthropic',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
    ollamaBaseUrl: ollamaConfig.baseUrl,
    ollamaModel: ollamaConfig.model,
    ollamaTimeoutMs: ollamaConfig.timeoutMs,
  },
  cache: {
    enabled: parseBooleanEnv(process.env.ENABLE_CACHE, true),
    ttlSeconds: parsePositiveIntEnv(process.env.CACHE_TTL, 24 * 60 * 60),
  },
  usage: {
    monthlyTokenQuota: parsePositiveIntEnv(process.env.MONTHLY_TOKEN_QUOTA, 10000),
    enablePromptCache: parseBooleanEnv(process.env.ENABLE_PROMPT_CACHE, true),
  },
};

import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  ai: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    // Haiku is the fast/cheap Claude model — enough for a structured
    // classification task (cold/warm/hot + confidence + reasoning).
    // claude-3-5-haiku-latest was deprecated/retired; use the current
    // Haiku alias instead (see `models.list()` for the account's options).
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
  },
};

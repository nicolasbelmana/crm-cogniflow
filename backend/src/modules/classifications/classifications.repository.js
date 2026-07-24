/**
 * Only place in the codebase that knows the `classifications` table's SQL.
 * Receives `pool` by parameter (same pattern as leads.repository.js /
 * auth.repository.js) so it stays swappable/testable.
 */
export function createClassificationsRepository(pool) {
  return {
    async create({ leadId, userId, temperature, confidence, reasoning, tokensUsed, modelUsed, promptHash = null }) {
      const result = await pool.query(
        `INSERT INTO classifications (lead_id, user_id, temperature, confidence, reasoning, tokens_used, model_used, prompt_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, lead_id, user_id, temperature, confidence, reasoning, tokens_used, model_used, prompt_hash, created_at`,
        [leadId, userId, temperature, confidence, reasoning, tokensUsed, modelUsed, promptHash]
      );

      return result.rows[0];
    },

    async findAllByLeadId(leadId, userId) {
      const result = await pool.query(
        `SELECT id, lead_id, user_id, temperature, confidence, reasoning, tokens_used, model_used, prompt_hash, created_at
         FROM classifications
         WHERE lead_id = $1 AND user_id = $2
         ORDER BY created_at DESC`,
        [leadId, userId]
      );

      return result.rows;
    },

    /**
     * Most recent classification for a lead (docs/OPTIMIZACION_API_CLAUDE.md,
     * opción 5): used by classifications.service.js to compare prompt_hash
     * before deciding whether an Anthropic call is actually needed.
     */
    async findLatestByLeadId(leadId, userId) {
      const result = await pool.query(
        `SELECT id, lead_id, user_id, temperature, confidence, reasoning, tokens_used, model_used, prompt_hash, created_at
         FROM classifications
         WHERE lead_id = $1 AND user_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [leadId, userId]
      );

      return result.rows[0] ?? null;
    },

    /**
     * Número de clasificaciones registradas para un lead desde `since`
     * (docs/OPTIMIZACION_API_CLAUDE.md, opción 6): usado por
     * classifications.service.js para aplicar un límite simple de
     * reclasificaciones/día antes de llamar a la IA.
     */
    async countByLeadIdSince(leadId, userId, since) {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM classifications
         WHERE lead_id = $1 AND user_id = $2 AND created_at >= $3`,
        [leadId, userId, since]
      );

      return result.rows[0]?.count ?? 0;
    },

    /**
     * Monitoreo de costos por uso de tokens (docs/OPTIMIZACION_API_CLAUDE.md,
     * opción 6): agrega `tokens_used` por día y por lead para un usuario,
     * dentro de una ventana de tiempo (`since`).
     */
    async getUsageByDay(userId, since) {
      const result = await pool.query(
        `SELECT DATE(created_at) AS day,
                COUNT(*)::int AS classifications_count,
                COALESCE(SUM(tokens_used), 0)::int AS tokens_used
         FROM classifications
         WHERE user_id = $1 AND created_at >= $2
         GROUP BY DATE(created_at)
         ORDER BY day DESC`,
        [userId, since]
      );

      return result.rows;
    },

    async getUsageByLead(userId, since) {
      const result = await pool.query(
        `SELECT lead_id,
                COUNT(*)::int AS classifications_count,
                COALESCE(SUM(tokens_used), 0)::int AS tokens_used,
                MAX(created_at) AS last_classified_at
         FROM classifications
         WHERE user_id = $1 AND created_at >= $2
         GROUP BY lead_id
         ORDER BY tokens_used DESC`,
        [userId, since]
      );

      return result.rows;
    },

    async getUsageTotals(userId, since) {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS classifications_count,
                COALESCE(SUM(tokens_used), 0)::int AS tokens_used
         FROM classifications
         WHERE user_id = $1 AND created_at >= $2`,
        [userId, since]
      );

      return result.rows[0] ?? { classifications_count: 0, tokens_used: 0 };
    },
  };
}

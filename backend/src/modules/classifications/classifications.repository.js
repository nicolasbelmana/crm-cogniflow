/**
 * Only place in the codebase that knows the `classifications` table's SQL.
 * Receives `pool` by parameter (same pattern as leads.repository.js /
 * auth.repository.js) so it stays swappable/testable.
 */
export function createClassificationsRepository(pool) {
  return {
    async create({
      leadId,
      userId,
      temperature,
      confidence,
      reasoning,
      tokensUsed,
      modelUsed,
      providerUsed = null,
      promptHash = null,
      inputTokens = 0,
      outputTokens = 0,
      estimatedCostUsd = 0,
    }) {
      const result = await pool.query(
        `INSERT INTO classifications (
          lead_id,
          user_id,
          temperature,
          confidence,
          reasoning,
          tokens_used,
          model_used,
          provider_used,
          prompt_hash,
          input_tokens,
          output_tokens,
          estimated_cost_usd
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, lead_id, user_id, temperature, confidence, reasoning, tokens_used, model_used, provider_used, prompt_hash, input_tokens, output_tokens, estimated_cost_usd, created_at`,
        [
          leadId,
          userId,
          temperature,
          confidence,
          reasoning,
          tokensUsed,
          modelUsed,
          providerUsed,
          promptHash,
          inputTokens,
          outputTokens,
          estimatedCostUsd,
        ]
      );

      return result.rows[0];
    },

    async findAllByLeadId(leadId, userId) {
      const result = await pool.query(
        `SELECT id, lead_id, user_id, temperature, confidence, reasoning, tokens_used, model_used, provider_used, prompt_hash, input_tokens, output_tokens, estimated_cost_usd, created_at
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
        `SELECT id, lead_id, user_id, temperature, confidence, reasoning, tokens_used, model_used, provider_used, prompt_hash, input_tokens, output_tokens, estimated_cost_usd, created_at
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
                provider_used,
                COUNT(*)::int AS classifications_count,
                COALESCE(SUM(tokens_used), 0)::int AS tokens_used,
                COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
                COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
                COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd
         FROM classifications
         WHERE user_id = $1 AND created_at >= $2
         GROUP BY DATE(created_at), provider_used
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
                COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd,
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
        `SELECT provider_used,
                COUNT(*)::int AS classifications_count,
                COALESCE(SUM(tokens_used), 0)::int AS tokens_used,
                COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
                COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
                COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd
         FROM classifications
         WHERE user_id = $1 AND created_at >= $2
         GROUP BY provider_used`,
        [userId, since]
      );

      return result.rows;
    },

    async getUsageByDayAndModel(userId, since) {
      const result = await pool.query(
        `SELECT DATE(created_at) AS day,
                model_used,
                provider_used,
                COUNT(*)::int AS calls_count,
                COALESCE(SUM(tokens_used), 0)::int AS tokens_used,
                COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
                COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
                COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd
         FROM classifications
         WHERE user_id = $1 AND created_at >= $2
         GROUP BY DATE(created_at), model_used, provider_used
         ORDER BY day DESC, model_used ASC`,
        [userId, since]
      );

      return result.rows;
    },

    async getCurrentMonthUsageTotals(userId) {
      const result = await pool.query(
        `SELECT provider_used,
                COUNT(*)::int AS classifications_count,
                COALESCE(SUM(tokens_used), 0)::int AS tokens_used,
                COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd
         FROM classifications
         WHERE user_id = $1
           AND created_at >= DATE_TRUNC('month', NOW())
         GROUP BY provider_used`,
        [userId]
      );

      return result.rows;
    },
  };
}

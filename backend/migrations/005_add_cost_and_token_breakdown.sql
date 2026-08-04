ALTER TABLE classifications
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(12, 8) NOT NULL DEFAULT 0;

UPDATE classifications
SET input_tokens = tokens_used,
    output_tokens = 0,
    estimated_cost_usd = 0
WHERE (input_tokens = 0 AND output_tokens = 0) AND tokens_used > 0;

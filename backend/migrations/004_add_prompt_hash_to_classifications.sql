-- Adds prompt_hash to classifications so classifications.service.js can
-- detect that a lead's classification prompt hasn't changed since the
-- last run and skip a redundant Anthropic API call
-- (docs/OPTIMIZACION_API_CLAUDE.md, opción 5).
ALTER TABLE classifications
  ADD COLUMN IF NOT EXISTS prompt_hash VARCHAR(64);

-- Speeds up "latest classification for this lead" lookups used to compare
-- the current prompt_hash before deciding to (re)classify.
CREATE INDEX IF NOT EXISTS idx_classifications_lead_created_hash
  ON classifications (lead_id, created_at DESC, prompt_hash);

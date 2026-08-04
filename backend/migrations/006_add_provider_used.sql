-- Add provider_used column to classifications to record which provider served the call
ALTER TABLE classifications
  ADD COLUMN IF NOT EXISTS provider_used TEXT;

-- Backfill existing rows with 'anthropic' if model indicates claude-haiku, otherwise 'ollama' as best-effort
UPDATE classifications
SET provider_used = CASE
  WHEN model_used LIKE 'claude-%' THEN 'anthropic'
  ELSE 'ollama'
END
WHERE provider_used IS NULL;

CREATE TABLE IF NOT EXISTS classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  temperature VARCHAR(10) NOT NULL CHECK (temperature IN ('cold', 'warm', 'hot')),
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reasoning VARCHAR(300) NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  model_used VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classifications_lead_id ON classifications (lead_id);
CREATE INDEX IF NOT EXISTS idx_classifications_user_id ON classifications (user_id);
-- Speeds up "most recent classification per lead" lookups (leads listing / dashboard).
CREATE INDEX IF NOT EXISTS idx_classifications_lead_created
  ON classifications (lead_id, created_at DESC);

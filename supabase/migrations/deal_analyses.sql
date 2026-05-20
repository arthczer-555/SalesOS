-- Deep deal analysis cache. One row per HubSpot deal_id (last analysis wins).
-- Triggered by the "Analyse approfondie" button on /deals; the heavy work runs
-- in a Netlify Background Function because Slack search + Claude can exceed the
-- ~26s sync timeout. UI polls this row until status='done'.

CREATE TABLE IF NOT EXISTS deal_analyses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         TEXT UNIQUE NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  analysis        JSONB,
  model           TEXT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_analyses_status ON deal_analyses (status);
CREATE INDEX IF NOT EXISTS idx_deal_analyses_updated ON deal_analyses (updated_at DESC);

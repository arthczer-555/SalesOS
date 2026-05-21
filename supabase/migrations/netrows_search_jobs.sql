-- Netrows search jobs: async fan-out for multi-company × multi-title people search.
-- Triggered via Netlify Background Function (15 min budget) since the cross-product
-- can take longer than the sync function timeout (~26s on Pro plan).

CREATE TABLE IF NOT EXISTS netrows_search_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | error
  criteria      JSONB NOT NULL,                  -- { companies, titles, keywords }
  combos_total  INT NOT NULL DEFAULT 0,
  combos_done   INT NOT NULL DEFAULT 0,
  profiles      JSONB,                           -- EnrichmentProfile[]
  total         INT,                             -- sum of Netrows total counts across combos
  capped        JSONB,                           -- { requested, limit } when truncated
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_netrows_search_jobs_user ON netrows_search_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_netrows_search_jobs_status ON netrows_search_jobs (status);

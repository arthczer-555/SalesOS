-- Jobs de découverte bulk Apollo sur la watchlist.
-- Pour chaque company de la watchlist liée à HubSpot, recherche les profils ICP
-- (top N), exclut ceux déjà présents (contacts HubSpot associés) et accumule les
-- NOUVEAUX candidats (emails masqués, pas de crédit consommé à ce stade). Le
-- reveal + push HubSpot se fait ensuite sur la sélection via apollo_enrichment_jobs.
-- Exécuté en Background Function Netlify (1 search Apollo + lookups HubSpot par
-- company), le front poll le statut.

CREATE TABLE IF NOT EXISTS apollo_bulk_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', -- running | done | error
  -- Filtres ICP utilisés (titres / séniorités / location / cap par company).
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Résultat par company : BulkCompanyResult[] (candidats nouveaux + statut).
  companies JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB, -- { companies_total, companies_searched, candidates_total }
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS apollo_bulk_jobs_created_at_idx ON apollo_bulk_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS apollo_bulk_jobs_user_id_idx ON apollo_bulk_jobs (user_id);

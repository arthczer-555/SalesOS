-- Jobs d'enrichissement Apollo -> HubSpot (watchlist).
-- Un job = une validation depuis la modale Apollo : on révèle les emails des
-- profils ICP sélectionnés (crédits Apollo), on crée/dédup les contacts HubSpot
-- et on les associe à la company HubSpot CHOISIE (hubspot_company_id, cible
-- fixe, zéro match flou). Exécuté en Background Function Netlify (reveal+create
-- de N contacts dépasse le timeout sync), le front poll le statut.

CREATE TABLE IF NOT EXISTS apollo_enrichment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  -- Backfill optionnel : si l'enrich part d'une fiche watchlist, on relie le job
  -- au scope_company pour pouvoir y reporter le hubspot_company_id résolu.
  scope_company_id UUID REFERENCES scope_companies(id) ON DELETE SET NULL,
  -- Cible d'association par défaut (company HubSpot explicitement sélectionnée).
  -- Nullable : en mode bulk, chaque profil porte sa propre company (issue de la
  -- watchlist) dans input_people, donc pas de cible unique au niveau du job.
  hubspot_company_id TEXT,
  hubspot_company_name TEXT,
  hubspot_company_domain TEXT,
  -- Owner posé sur les contacts créés (users.hubspot_owner_id de l'appelant).
  hubspot_owner_id TEXT,
  -- Option "Ajouter à la watchlist" : nom du rep owner (sinon null).
  add_to_scope_owner TEXT,
  status TEXT NOT NULL DEFAULT 'running', -- running | done | error
  -- Profils ICP cochés à traiter (EnrichPersonInput[]), source de vérité pour
  -- le worker background (lu depuis la row, pas le body du dispatch).
  input_people JSONB NOT NULL DEFAULT '[]'::jsonb,
  people JSONB NOT NULL DEFAULT '[]'::jsonb, -- PersonResult[] (progression)
  summary JSONB,
  error TEXT,
  credits_used INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS apollo_enrichment_jobs_created_at_idx ON apollo_enrichment_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS apollo_enrichment_jobs_user_id_idx ON apollo_enrichment_jobs (user_id);
CREATE INDEX IF NOT EXISTS apollo_enrichment_jobs_scope_company_id_idx ON apollo_enrichment_jobs (scope_company_id);

-- Org Chart / Account Mapping — base Supabase (source de vérité unique).
--
-- Un compte (orgchart_accounts) = un organigramme. Les personnes
-- (orgchart_people) forment un arbre via manager_id auto-référentiel
-- (adjacency list : chaque personne a au plus un manager). Les clusters de
-- l'organigramme se déduisent de `entity` (lieu / business unit), les positions
-- whiteboard de pos_x/pos_y. Colonnes personnalisées : custom_columns au niveau
-- compte (définitions) + custom_fields JSONB par personne (valeurs), pour
-- façonner la table comme un Excel sans migration.
--
-- Pas de RLS : accès via la clé service-role (lib/db.ts), comme le reste de
-- l'app.

-- ── Comptes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orgchart_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  hubspot_company_id TEXT,
  domain TEXT,
  owner TEXT,
  -- Définitions des colonnes personnalisées : [{ key, label, type, options? }].
  custom_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orgchart_accounts_name_idx ON orgchart_accounts (LOWER(name));
CREATE INDEX IF NOT EXISTS orgchart_accounts_created_at_idx ON orgchart_accounts (created_at DESC);

-- ── Personnes (nœuds de l'organigramme) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS orgchart_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES orgchart_accounts(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  title TEXT,                 -- poste vérifié / LinkedIn (affiché en priorité)
  title_hubspot TEXT,         -- poste tel que dans HubSpot
  department TEXT,
  entity TEXT,                -- lieu / business unit (clé de cluster)

  level TEXT,                 -- c_level | vp | director | manager | ic | unknown
  decision_role TEXT,         -- decision_maker | champion | influencer | gatekeeper | user | unknown
  relationship_status TEXT,   -- engaged | cold | never_contacted | left | unknown

  -- Lien hiérarchique : manager direct (NULL = racine). ON DELETE SET NULL pour
  -- que les subordonnés remontent quand on supprime un manager.
  manager_id UUID REFERENCES orgchart_people(id) ON DELETE SET NULL,

  last_interaction DATE,
  deal TEXT,
  owner TEXT,                 -- owner Coachello
  linkedin_url TEXT,
  email TEXT,
  hubspot_contact_id TEXT,
  hubspot_company_id TEXT,    -- company HubSpot d'origine de la personne (multi-company)
  in_hubspot BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  apollo_id TEXT,

  pos_x DOUBLE PRECISION,
  pos_y DOUBLE PRECISION,

  level_confidence REAL,      -- confiance de la classification IA (0-1)
  manager_confidence REAL,    -- confiance du lien reporte-à inféré (0-1)

  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | csv | hubspot | apollo

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orgchart_people_account_id_idx ON orgchart_people (account_id);
CREATE INDEX IF NOT EXISTS orgchart_people_manager_id_idx ON orgchart_people (manager_id);

-- Sécurité si la table existait déjà (migration ré-exécutée).
ALTER TABLE orgchart_people ADD COLUMN IF NOT EXISTS hubspot_company_id TEXT;

-- ── Company HubSpot rattachées à un compte (un compte = N company) ───────────
-- Ex : "Allianz" regroupe Allianz Trade + Allianz Partners + Allianz Technology.
CREATE TABLE IF NOT EXISTS orgchart_account_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES orgchart_accounts(id) ON DELETE CASCADE,
  hubspot_company_id TEXT NOT NULL,
  name TEXT,
  domain TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, hubspot_company_id)
);

CREATE INDEX IF NOT EXISTS orgchart_account_companies_account_id_idx ON orgchart_account_companies (account_id);

-- ── Jobs d'import (HubSpot / CSV + classification Claude, en background) ──────
CREATE TABLE IF NOT EXISTS orgchart_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  account_id UUID REFERENCES orgchart_accounts(id) ON DELETE SET NULL,
  source TEXT NOT NULL,       -- hubspot | csv
  company_name TEXT,
  hubspot_company_id TEXT,
  status TEXT NOT NULL DEFAULT 'running', -- running | done | error
  params JSONB,               -- lignes CSV mappées ou params de fetch HubSpot
  result JSONB,               -- compteurs (created, classified, ...)
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orgchart_import_jobs_user_id_idx ON orgchart_import_jobs (user_id);
CREATE INDEX IF NOT EXISTS orgchart_import_jobs_created_at_idx ON orgchart_import_jobs (created_at DESC);

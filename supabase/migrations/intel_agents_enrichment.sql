-- Market Intel refonte v2 : agents + enrichissement
-- À exécuter dans Supabase SQL Editor

-- ── 1. Dimension agent dans market_signals + flag archived ───────────────────

ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS agent_id text;
ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_market_signals_agent
  ON market_signals (user_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_signals_status
  ON market_signals (user_id, is_read, is_actioned, archived);

-- Backfill agent_id depuis signal_type pour les signaux existants
UPDATE market_signals SET agent_id = CASE
  WHEN signal_type = 'job_change' THEN 'job-change'
  WHEN signal_type = 'hiring' THEN 'hiring-spike'
  WHEN signal_type IN ('linkedin_post','nomination') THEN 'company-news'
  WHEN signal_type = 'content' THEN 'intent-content'
  WHEN signal_type IN ('funding','expansion') THEN 'funding-expansion'
  WHEN signal_type = 'restructuring' THEN 'company-news'
  ELSE 'company-news' END
WHERE agent_id IS NULL;

-- ── 2. État runtime des agents (per-user) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS intel_agent_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  agent_id text NOT NULL,
  enabled boolean DEFAULT true,
  last_run_at timestamp,
  last_run_status text,                     -- 'ok' | 'error' | 'partial'
  last_run_signals_count int DEFAULT 0,
  last_run_error text,
  config jsonb,                             -- per-agent config (keywords, profile lists)
  UNIQUE(user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_intel_agent_runs_user
  ON intel_agent_runs (user_id, agent_id);

-- ── 3. Listes d'enrichissement sauvegardées ──────────────────────────────────

CREATE TABLE IF NOT EXISTS enrichment_lists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  name text NOT NULL,
  source text NOT NULL,                     -- 'netrows' | 'hubspot' | 'mixed'
  criteria jsonb,
  results jsonb,                            -- [{ username, fullName, headline, company, profileUrl, email, hubspotId, selected, source, addedToRadar }]
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrich_lists_user
  ON enrichment_lists (user_id, updated_at DESC);

-- ── 4. Watchlist (ajout manuel libre) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS linkedin_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  full_name text,
  current_headline text,
  current_company text,
  added_by uuid REFERENCES users(id),
  tags text[],
  notes text,
  created_at timestamp DEFAULT now()
);

-- ── 5. Profils concurrents (Competitor Activity Agent) ───────────────────────

CREATE TABLE IF NOT EXISTS linkedin_competitor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  full_name text,
  headline text,
  competitor_name text,
  role_type text,                           -- 'AE' | 'AM' | 'BDR' | 'SDR'
  last_checked_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_profiles_company
  ON linkedin_competitor_profiles (competitor_name);

-- ── 6. Concurrents marketing (page /marketing/linkedin) ──────────────────────

CREATE TABLE IF NOT EXISTS marketing_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  name text,
  category text,                            -- 'direct' | 'indirect' | 'inspiration'
  created_at timestamp DEFAULT now()
);

-- ── 7. Cache résolutions username (fallback nom/prénom) ──────────────────────

CREATE TABLE IF NOT EXISTS linkedin_username_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lookup_key text UNIQUE NOT NULL,          -- hash(firstName + lastName + company) ou email normalisé
  username text,
  resolved_at timestamp DEFAULT now()
);

-- ── 8. Source typing pour linkedin_monitored_profiles ────────────────────────
-- Ajout des sources possibles utilisées par la page /intel/enrich :
-- 'manual' | 'init' | 'hubspot' | 'netrows-search' | 'champion' | 'competitor'
-- Pas de contrainte CHECK : on garde la souplesse.

COMMENT ON COLUMN linkedin_monitored_profiles.source IS
  'manual | init | hubspot | netrows-search | champion | competitor';

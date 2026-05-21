-- Cache des analyses générées à la demande sur la page détail d'un compte
-- Watch List (synthèse IA, news Netrows, recap HubSpot). Chaque kind a sa
-- propre row par compte (unique constraint), avec un JSONB content dont
-- la forme dépend du kind (typée côté TS dans lib/watchlist/briefs.ts).
--
-- Status flow :
--   idle    -> jamais généré
--   running -> job en cours (sync ou BG fn). Un lock 5 min côté API
--              empêche le double-dispatch.
--   ok      -> dernière génération réussie, content peuplé
--   error   -> dernière génération en erreur, error peuplé
--
-- triggered_by_user_id : utilisateur qui a cliqué "Régénérer". Pas de FK
-- vers auth.users pour rester souple (la table users côté Supabase peut
-- exister ou non selon le setup local) — on stocke juste l'uuid.

CREATE TABLE IF NOT EXISTS watchlist_company_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_company_id UUID NOT NULL REFERENCES scope_companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ai_summary', 'news', 'hubspot_recap')),
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'ok', 'error')),
  content JSONB,
  error TEXT,
  model TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  triggered_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope_company_id, kind)
);

CREATE INDEX IF NOT EXISTS watchlist_briefs_status_idx
  ON watchlist_company_briefs (scope_company_id, status);

CREATE INDEX IF NOT EXISTS watchlist_briefs_kind_idx
  ON watchlist_company_briefs (kind);

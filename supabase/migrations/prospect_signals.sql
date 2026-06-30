-- Signaux de prospection persistants, alimentant la page /signals (feed Tinder)
-- et la fiche compte Watch List.
--
-- Deux flux (colonne `feed`) :
--   watchlist  -> signaux sur un compte déjà dans scope_companies (barre normale)
--   discovery  -> signaux sur un compte PAS encore dans la watchlist (barre haute,
--                 déclenché par thème : coaching, restructuration, leadership...)
--
-- scope_company_id est NULLABLE : un signal discovery porte l'identité de la
-- société sur la row elle-même (company_name/domain/linkedin) tant que le compte
-- n'est pas ajouté à la watchlist. Au moment du "act", on insère le compte dans
-- scope_companies et on rattache le signal.
--
-- Cycle de vie (status) :
--   new       -> à traiter, visible dans le feed (fenêtre de fraîcheur 14 j)
--   actioned  -> swipe droite : brouillon généré, visible sur la fiche compte
--   dismissed -> swipe gauche : retiré du feed pour toujours
--   snoozed   -> repoussé, revient quand snooze_until < now()
--   expired   -> jamais traité et trop vieux (purge par le sweep)
--   deleted   -> masqué définitivement par l'utilisateur (fiche compte). On garde
--                la row pour conserver la dedupe_key : le sweep ne le réinsère jamais.
--
-- dedupe_key UNIQUE : inclut l'identité société + le contenu, pour un upsert
-- "insert only new" (ON CONFLICT (dedupe_key) DO NOTHING) uniforme sur les deux flux.

CREATE TABLE IF NOT EXISTS prospect_signals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_company_id UUID REFERENCES scope_companies(id) ON DELETE CASCADE,
  feed             TEXT NOT NULL CHECK (feed IN ('watchlist', 'discovery')),
  company_name     TEXT NOT NULL,
  company_domain   TEXT,
  company_linkedin TEXT,
  signal_type      TEXT NOT NULL,
  source           TEXT NOT NULL,
  category         TEXT,
  title            TEXT NOT NULL,
  url              TEXT,
  summary          TEXT,
  why_relevant     TEXT,
  suggested_action TEXT,
  payload          JSONB,
  score            INTEGER NOT NULL DEFAULT 0,
  dedupe_key       TEXT NOT NULL UNIQUE,
  -- Empreinte PAR CONTENU (entités du fait), indépendante de l'URL : déduplique
  -- la même info venue de 2 URLs/sources. Nullable, non unique, blocage côté
  -- applicatif (cf. migration prospect_signals_content_key.sql).
  content_key      TEXT,
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'actioned', 'dismissed', 'snoozed', 'expired', 'deleted')),
  snooze_until     TIMESTAMPTZ,
  actioned_at      TIMESTAMPTZ,
  dismissed_at     TIMESTAMPTZ,
  draft_subject    TEXT,
  draft_body       TEXT,
  draft_recipient  JSONB,
  created_by       UUID,
  signal_date      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lecture du feed : par flux + status, trié score puis date.
CREATE INDEX IF NOT EXISTS prospect_signals_feed_idx
  ON prospect_signals (feed, status, score DESC, signal_date DESC);

-- Signaux d'un compte (fiche Watch List) + plafonds par compte dans le sweep.
CREATE INDEX IF NOT EXISTS prospect_signals_company_idx
  ON prospect_signals (scope_company_id, status);

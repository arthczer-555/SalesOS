-- Posts LinkedIn PROPRES (page entreprise "pro" + profil perso) scrapés
-- hebdomadairement via Bright Data, en remplacement de la saisie manuelle.
--
-- Les impressions / le reach LinkedIn sont des analytics PRIVÉES (visibles
-- uniquement par le propriétaire du compte) → NON scrapables : saisie manuelle
-- via la modale du dashboard, avec rappel Slack hebdo (posts de +7j sans impressions).
--
-- post_url UNIQUE = clé d'upsert : un re-scrape met à jour likes/comments/texte
-- mais ne dédouble jamais et NE TOUCHE PAS aux impressions (saisie manuelle préservée).
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_linkedin_posts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_url               TEXT NOT NULL UNIQUE,                    -- clé d'upsert
  source                 TEXT NOT NULL CHECK (source IN ('pro', 'perso')),
  source_url             TEXT NOT NULL,                           -- URL company/profile d'origine
  author                 TEXT,
  content                TEXT NOT NULL DEFAULT '',
  posted_at              TIMESTAMPTZ,
  likes                  INTEGER NOT NULL DEFAULT 0,
  comments               INTEGER NOT NULL DEFAULT 0,
  impressions            INTEGER,                                 -- NULLABLE : saisie manuelle
  impressions_updated_at TIMESTAMPTZ,
  impressions_updated_by TEXT,
  notified_at            TIMESTAMPTZ,                             -- idempotence du digest Slack
  raw                    JSONB,                                   -- ligne brute Bright Data (debug)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lecture de l'onglet (plus récents d'abord) + requête "posts +7j sans impressions".
CREATE INDEX IF NOT EXISTS marketing_linkedin_posts_posted_at_idx
  ON marketing_linkedin_posts (posted_at DESC);

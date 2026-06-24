-- Lien event ↔ post LinkedIn scrapé : permet au scrape hebdo d'actualiser tout
-- seul les marqueurs `linkedin_pro` / `linkedin_perso` du graphe Trafic, sans
-- toucher aux events saisis à la main.
--
-- En Postgres, une contrainte UNIQUE traite plusieurs NULL comme distincts : les
-- events manuels gardent `linkedin_post_url = NULL` (jamais en conflit), tandis
-- que les events auto-créés par le scrape sont dédupliqués par URL de post
-- (upsert onConflict: "linkedin_post_url"). Les events auto portent
-- `created_by = 'auto:linkedin-scrape'` pour les distinguer.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS linkedin_post_url TEXT;

ALTER TABLE marketing_events
  ADD CONSTRAINT marketing_events_linkedin_post_url_key UNIQUE (linkedin_post_url);

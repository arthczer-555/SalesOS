-- Ajout colonnes nécessaires au pipeline Market Intel Company-News :
--   - linkedin_username : vrai slug LinkedIn de la page company. Résolu via
--     Netrows /companies/search au moment de l'ajout. Sans ce slug, l'agent
--     Company-News tombait sur le slug heuristique (slugifyCompany) qui ne
--     matche pas la majorité des grands comptes (ex: "L'Oréal" → "loreal" et
--     pas "l-oreal").
--   - linkedin_username_source : 'netrows', 'manual' ou 'fallback' pour
--     savoir si on a confiance dans le slug (les fallbacks heuristiques sont
--     à re-résoudre).
--   - linkedin_username_resolved_at : timestamp de la dernière résolution.
--   - radar_added_at : timestamp d'ajout au Radar Netrows (1 crédit one-time,
--     monitoring gratuit ensuite). NULL = pas encore poussé.
--   - radar_failed_reason : si l'add Radar a échoué, on stocke la raison
--     (credits, rate-limit, auth, slug unknown) pour pouvoir retry plus tard.

ALTER TABLE scope_companies
  ADD COLUMN IF NOT EXISTS linkedin_username TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_username_source TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_username_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS radar_added_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS radar_failed_reason TEXT;

-- Index sur linkedin_username pour les futures jointures (ex: match company.url
-- d'un webhook Netrows vers une scope_company).
CREATE INDEX IF NOT EXISTS scope_companies_linkedin_username_idx
  ON scope_companies(linkedin_username)
  WHERE linkedin_username IS NOT NULL;

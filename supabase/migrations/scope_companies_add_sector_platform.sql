-- Ajout de deux colonnes d'enrichissement sur scope_companies :
--   - sector : secteur d'activité (texte libre)
--   - current_coaching_platform : plateforme de coaching actuellement utilisée
--     par l'entreprise (concurrent ou complément).
-- Les deux sont nullables, alimentés à la main ou via import CSV.

ALTER TABLE scope_companies
  ADD COLUMN IF NOT EXISTS sector TEXT,
  ADD COLUMN IF NOT EXISTS current_coaching_platform TEXT;

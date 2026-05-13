-- Lie les profils Radar à un contact HubSpot quand l'origine est un import HubSpot.
-- Permet un matching exact (au lieu de dépendre de linkedin_url, rarement rempli)
-- pour le calcul d'overlap et l'exclusion à l'import.

ALTER TABLE linkedin_monitored_profiles
  ADD COLUMN IF NOT EXISTS hubspot_id text;

CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_hubspot_id
  ON linkedin_monitored_profiles (hubspot_id)
  WHERE hubspot_id IS NOT NULL;

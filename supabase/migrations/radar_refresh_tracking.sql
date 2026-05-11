-- Radar : suivi des refresh manuels par profil
-- Permet de détecter les profils stale et d'afficher la fraîcheur dans la table Radar.

ALTER TABLE linkedin_monitored_profiles
  ADD COLUMN IF NOT EXISTS last_refreshed_at timestamp;

CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_radar_refreshed
  ON linkedin_monitored_profiles (radar_active, last_refreshed_at);

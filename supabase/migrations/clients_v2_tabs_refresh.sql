-- Fiche client v2 (onglets Key insights / Knowledge / To do / HubSpot cleaner,
-- refresh hebdo qui lit aussi Slack).
-- ────────────────────────────────────────────────────────────────────────
-- coach_brief_edited_at : dernière édition manuelle du coach brief (route
--   PATCH /content). Le refresh ne régénère pas un brief retouché à la main
--   après sa dernière génération (coach_brief_generated_at).
--
-- Les nouveaux meetings Claap détectés au refresh sont désormais retenus
-- automatiquement : pending_refresh_meeting_candidates n'est plus alimentée
-- (colonne conservée, purgée au prochain refresh de chaque client).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS coach_brief_edited_at TIMESTAMPTZ;

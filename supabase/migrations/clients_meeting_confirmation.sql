-- Confirmation des meetings Claap avant analyse d'un nouveau client
-- ────────────────────────────────────────────────────────────────────────
-- On insère un garde-fou entre l'import (webhook closed-won OU backfill manuel)
-- et l'enrichissement IA : on découvre d'abord les meetings Claap du compte, un
-- humain les confirme (et en ajoute si besoin), PUIS l'analyse démarre sur
-- l'ensemble validé.
--
-- Nouvel état du cycle de vie (clients.enrichment_status, colonne TEXT libre) :
--   import → 'awaiting_meetings' → (confirmation humaine) → 'running' → 'done'|'error'
--
-- pending_meeting_candidates : candidats découverts à l'import (metadata only,
--   sans transcript), affichés dans le popup de confirmation. Format par item :
--   { "recording_id", "meeting_title", "meeting_started_at", "claap_url",
--     "source": "indexed" | "discovered" }
--
-- confirmed_claap_recordings : set final validé par l'humain (gardés + ajoutés).
--   Format par item :
--   { "recording_id", "meeting_title", "meeting_started_at", "claap_url",
--     "added_manually": bool }
--   C'est CETTE liste que l'enrichissement consomme (au lieu de re-deviner via
--   la discovery aveugle).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS pending_meeting_candidates       JSONB,
  ADD COLUMN IF NOT EXISTS confirmed_claap_recordings       JSONB,
  ADD COLUMN IF NOT EXISTS meetings_confirmed_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meetings_confirmed_by            TEXT,
  -- Idempotence du DM Slack "confirme les meetings" (même logique que
  -- owner_notified_at pour la notif d'enrichissement terminé).
  ADD COLUMN IF NOT EXISTS meeting_confirmation_requested_at TIMESTAMPTZ;

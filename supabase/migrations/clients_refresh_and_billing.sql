-- Colonnes pour 3 features sur la fiche client :
--   1. Refresh incrémental (bouton "Actualiser" + cron mensuel) : on garde la
--      date du dernier refresh et un "petit point" (RefreshReport) affiché en
--      bandeau sur la fiche (health avant/après + fields qui ont changé).
--   2. DM Slack à l'owner quand un closed-won est enrichi : owner_notified_at
--      sert de flag d'idempotence (on ne DM qu'une fois, même si re-enrich).
--   3. Bloc facturation alimenté par l'onglet "Historique" du fichier revenue
--      (Google Drive xlsx), rafraîchi par le cron mensuel.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS last_refreshed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_refresh_report  JSONB,
  ADD COLUMN IF NOT EXISTS owner_notified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing              JSONB,
  ADD COLUMN IF NOT EXISTS billing_refreshed_at TIMESTAMPTZ;

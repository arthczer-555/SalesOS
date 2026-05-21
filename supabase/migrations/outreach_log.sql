-- Outreach log : trace tous les emails envoyés depuis SalesOS (prospection 1-to-1 + mass-prospection).
-- Permet d'afficher un badge "X échanges" à côté de chaque contact dans les UIs de sélection
-- (radar, mass-prospection setup, prospecting search).

CREATE TABLE IF NOT EXISTS outreach_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  email       TEXT NOT NULL,
  email_lower TEXT GENERATED ALWAYS AS (LOWER(email)) STORED,
  hubspot_id  TEXT,
  source      TEXT NOT NULL,
  source_id   UUID,
  subject     TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_log_user_email_lower
  ON outreach_log (user_id, email_lower);

CREATE INDEX IF NOT EXISTS idx_outreach_log_user_hubspot_id
  ON outreach_log (user_id, hubspot_id)
  WHERE hubspot_id IS NOT NULL;

-- Backfill depuis l'historique mass-prospection existant.
-- Idempotent : on filtre sur les paires (source, source_id) déjà présentes.
INSERT INTO outreach_log (user_id, email, hubspot_id, source, source_id, subject, sent_at)
SELECT c.user_id, e.email, e.hubspot_id, 'mass_prospection', e.id, e.subject, e.sent_at
FROM mass_campaign_emails e
JOIN mass_campaigns c ON c.id = e.campaign_id
WHERE e.sent_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM outreach_log o
    WHERE o.source = 'mass_prospection' AND o.source_id = e.id
  );

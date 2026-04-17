-- Mass Prospection: campaigns + per-prospect emails
-- ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mass_campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  name          TEXT,
  objective     TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft',
  qcm_type      TEXT,
  qcm_length    TEXT,
  qcm_tone      TEXT,
  qcm_objectif  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mass_campaigns_user ON mass_campaigns(user_id);

CREATE TABLE IF NOT EXISTS mass_campaign_emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES mass_campaigns(id) ON DELETE CASCADE,
  hubspot_id    TEXT,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL,
  job_title     TEXT DEFAULT '',
  company       TEXT DEFAULT '',
  industry      TEXT DEFAULT '',
  extra_data    JSONB DEFAULT '{}',
  subject       TEXT,
  body          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  generated_at  TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_emails_campaign ON mass_campaign_emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_emails_status ON mass_campaign_emails(status);

-- Flux #1y-new-meetings (décision du 2026-11-27) : une annonce de meeting dans
-- Slack devient, après un ✅ sur la réponse du bot, la carte Prospection /
-- R1 scheduled. À appliquer AVANT le déploiement du lot 1. Idempotente.

CREATE TABLE IF NOT EXISTS meeting_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Le message d'annonce (dans #1y, ou dans le DM du bot en mode test)
  slack_channel_id TEXT NOT NULL,
  slack_ts TEXT NOT NULL,
  slack_permalink TEXT,
  source_kind TEXT NOT NULL DEFAULT 'channel',      -- channel | mirror | dm_test
  posted_by_slack_id TEXT,
  posted_by_user_id UUID,
  text TEXT,
  files JSONB,
  text_hash TEXT,
  -- Où vit la conversation : le fil de l'annonce, ou le DM de test
  thread_channel TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  bot_message_ts TEXT,
  mode TEXT NOT NULL DEFAULT 'test',                -- test | live
  status TEXT NOT NULL DEFAULT 'received',          -- received | analyzing | ignored | proposed | awaiting_info | creating | created | linked | skipped | expired | failed | duplicate | cancelled
  lease_until TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  extraction JSONB,                                 -- lecture IA de l'annonce
  proposal JSONB,                                   -- proposition en cours (champs, provenance, personnes autorisées)
  proposal_version INT NOT NULL DEFAULT 0,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,     -- corrections du fil (priment sur l'annonce)
  thread_log JSONB NOT NULL DEFAULT '[]'::jsonb,    -- messages du fil traités, et ce qui en a été fait
  notes TEXT,
  confirm_intent_by TEXT,                           -- ✅ reçu alors qu'il manquait un champ
  confirm_intent_at TIMESTAMPTZ,
  owner_user_id UUID,
  owner_hubspot_id TEXT,
  contact_emails TEXT[] NOT NULL DEFAULT '{}',
  hubspot_contact_ids TEXT[] NOT NULL DEFAULT '{}',
  hubspot_company_id TEXT,
  meeting_date DATE,
  meeting_at TIMESTAMPTZ,
  hubspot_deal_id TEXT,
  deal_link_origin TEXT,                            -- created | linked
  lead_id UUID,
  reminder_sent_at TIMESTAMPTZ,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_announcements_message ON meeting_announcements (slack_channel_id, slack_ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_announcements_bot_message ON meeting_announcements (thread_channel, bot_message_ts) WHERE bot_message_ts IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_announcements_thread ON meeting_announcements (thread_channel, thread_ts);
CREATE INDEX IF NOT EXISTS idx_meeting_announcements_status ON meeting_announcements (status, created_at);
CREATE INDEX IF NOT EXISTS idx_meeting_announcements_emails ON meeting_announcements USING GIN (contact_emails);
CREATE INDEX IF NOT EXISTS idx_meeting_announcements_deal ON meeting_announcements (hubspot_deal_id) WHERE hubspot_deal_id IS NOT NULL;

-- File des événements Slack d'une annonce (réaction, message du fil,
-- modification, suppression), traités dans l'ordre des ts Slack. La clé est
-- l'event_id Slack : un rejeu n'ajoute rien.
CREATE TABLE IF NOT EXISTS meeting_announcement_events (
  event_id TEXT PRIMARY KEY,
  announcement_id UUID NOT NULL REFERENCES meeting_announcements(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,                               -- reaction | thread_message | edited | deleted
  slack_ts TEXT,
  slack_user_id TEXT,
  payload JSONB,
  processed_at TIMESTAMPTZ,
  result TEXT
);

CREATE INDEX IF NOT EXISTS idx_meeting_announcement_events_pending ON meeting_announcement_events (announcement_id, processed_at, slack_ts);

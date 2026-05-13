-- Sales Coach: meeting recap bullets (Context / Client Need / Risks / Opportunities / Next Steps)
-- ────────────────────────────────────────────────────────────────────────
-- Replaces the standalone HubSpot → Slack webhook (`/api/webhooks/hubspot/claap-note`).
-- The Claap webhook now generates this recap alongside the coaching analysis
-- and posts it to Slack on the same event.

ALTER TABLE sales_coach_analyses
  ADD COLUMN IF NOT EXISTS meeting_recap JSONB,
  ADD COLUMN IF NOT EXISTS meeting_recap_slack_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audience TEXT;

-- Idempotency table for the Claap note webhook (HubSpot retries).
-- The webhook calls scoreOneDeal + a Claude summary, which takes 10-20s,
-- well beyond HubSpot's ~5s webhook timeout. HubSpot retries the same
-- noteId, causing duplicate Slack messages. We claim each noteId here
-- as the very first step of processNote(); a conflict means it's a retry.

CREATE TABLE IF NOT EXISTS claap_notes_processed (
  note_id      TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Idempotency for the Netrows webhook ─────────────────────────────────
-- Netrows retries on 5xx; without dedup we duplicate signals × N users.
-- event_key = `${event}:${subject}:${timestamp}:${changeSig}` (built in handler).
CREATE TABLE IF NOT EXISTS netrows_events_processed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text UNIQUE NOT NULL,
  processed_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_netrows_events_processed_at
  ON netrows_events_processed (processed_at DESC);

-- ── Email-finder cache ───────────────────────────────────────────────────
-- 5-10 credits per call → cache 30 days. Stores nulls (= "not found") too,
-- so we don't repay for the same username.
CREATE TABLE IF NOT EXISTS linkedin_email_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  email text,
  confidence text,
  resolved_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_email_cache_username
  ON linkedin_email_cache (username);

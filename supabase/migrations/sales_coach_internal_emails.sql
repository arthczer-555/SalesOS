-- Sales Coach: store internal (Coachello) participant emails so the
-- "My meetings" filter can match attendees, not just the recorder.
-- Populated by the Claap webhook + backfill route; legacy rows are filled by
-- scripts/backfill-internal-emails.ts.
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE sales_coach_analyses
  ADD COLUMN IF NOT EXISTS internal_emails TEXT[];

-- GIN index for the `internal_emails @> '{email}'` containment filter used
-- by /api/sales-coach/list.
CREATE INDEX IF NOT EXISTS idx_sales_coach_analyses_internal_emails
  ON sales_coach_analyses USING GIN (internal_emails);

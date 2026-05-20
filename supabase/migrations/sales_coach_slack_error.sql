-- Sales Coach: persist Slack send errors per channel (coaching DM, recap DM)
-- so that failures surface in the DB instead of being swallowed by a
-- console.warn in the Netlify background function.
--
-- Distinct from error_message (analysis-level errors) on purpose: the analysis
-- can succeed (status=done) while one or both Slack sends fail, and we want
-- that signal to remain visible without overwriting the analysis status.

ALTER TABLE sales_coach_analyses
  ADD COLUMN IF NOT EXISTS slack_error TEXT,
  ADD COLUMN IF NOT EXISTS meeting_recap_slack_error TEXT;

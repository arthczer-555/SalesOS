-- Track who received each Slack message (coaching debrief + meeting recap).
-- recipients = array of internal emails that were DM'd.

ALTER TABLE sales_coach_analyses
  ADD COLUMN IF NOT EXISTS meeting_recap_slack_recipients TEXT[],
  ADD COLUMN IF NOT EXISTS slack_sent_recipients TEXT[];

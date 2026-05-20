-- Persist the lead origin extracted by Claude from the screenshots attached to
-- the Slack message ("how did you hear about us" field). Used by the "Origine
-- des leads" widget in /marketing > Leads to break down leads by source.

ALTER TABLE lead_analyses
  ADD COLUMN IF NOT EXISTS extracted_source TEXT;

CREATE INDEX IF NOT EXISTS idx_lead_analyses_source
  ON lead_analyses (extracted_source);

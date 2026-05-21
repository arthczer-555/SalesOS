-- Drop des colonnes liées à la résolution de slugs LinkedIn et au Radar
-- companies Netrows. Plus utilisé : on est passé en push-only via job-change
-- agent (webhook profile.changed).

DROP INDEX IF EXISTS scope_companies_linkedin_username_idx;

ALTER TABLE scope_companies
  DROP COLUMN IF EXISTS linkedin_username,
  DROP COLUMN IF EXISTS linkedin_username_source,
  DROP COLUMN IF EXISTS linkedin_username_resolved_at,
  DROP COLUMN IF EXISTS radar_added_at,
  DROP COLUMN IF EXISTS radar_failed_reason;

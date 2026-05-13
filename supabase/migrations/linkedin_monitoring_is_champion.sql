-- Adds an explicit is_champion flag on Radar profiles so champions can be
-- promoted manually without losing the original `source` (netrows-search,
-- hubspot, manual, …). Champion-tracker reads the union of the lifecycle
-- auto-discovery and this flag.

ALTER TABLE linkedin_monitored_profiles
  ADD COLUMN IF NOT EXISTS is_champion boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_is_champion
  ON linkedin_monitored_profiles (is_champion) WHERE is_champion = true;

-- Backfill : every profile already tagged `source='champion'` becomes a flagged
-- champion. The source itself is preserved.
UPDATE linkedin_monitored_profiles
  SET is_champion = true
  WHERE source = 'champion' AND is_champion = false;

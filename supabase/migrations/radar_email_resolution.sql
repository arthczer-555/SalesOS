-- Email résolu (HubSpot ou Netrows) stocké directement sur le profil radar.
-- Avant : seul `linkedin_email_cache` stockait l'email Netrows avec TTL 30j.
-- Maintenant : on garde aussi une copie persistante sur le profil pour pouvoir
-- afficher l'email dans la fiche radar, l'exporter et matcher le badge "X échanges"
-- même quand le profil n'a pas de hubspot_id.

ALTER TABLE linkedin_monitored_profiles
  ADD COLUMN IF NOT EXISTS email             TEXT,
  ADD COLUMN IF NOT EXISTS email_confidence  TEXT,
  ADD COLUMN IF NOT EXISTS email_source      TEXT,
  ADD COLUMN IF NOT EXISTS email_resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_email_lower
  ON linkedin_monitored_profiles (LOWER(email))
  WHERE email IS NOT NULL;

-- Backfill depuis le cache Netrows existant. Idempotent : on n'écrit que sur les
-- profils dont l'email n'est pas encore renseigné.
UPDATE linkedin_monitored_profiles p
SET email = c.email,
    email_confidence = c.confidence,
    email_source = 'netrows',
    email_resolved_at = c.resolved_at
FROM linkedin_email_cache c
WHERE c.username = p.username
  AND c.email IS NOT NULL
  AND p.email IS NULL;

-- Suivi des entreprises ICP : on remplace le simple tableau JSON stocké dans
-- guide_defaults.target_companies par une vraie table tabulaire (entreprise,
-- owner, notes) avec dédup case-insensitive. La table sales_reps existe pour
-- préparer une future vue "comptes par sales".

CREATE TABLE IF NOT EXISTS sales_reps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_reps_name_lower_uniq
  ON sales_reps (LOWER(name));

CREATE TABLE IF NOT EXISTS scope_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS scope_companies_name_lower_uniq
  ON scope_companies (LOWER(name));

CREATE INDEX IF NOT EXISTS scope_companies_owner_idx
  ON scope_companies (owner);

-- Backfill depuis guide_defaults.target_companies (JSON array de strings).
-- Idempotent : ON CONFLICT DO NOTHING sur l'index unique LOWER(name).
DO $$
DECLARE
  payload JSONB;
  item TEXT;
BEGIN
  SELECT content::jsonb INTO payload
  FROM guide_defaults
  WHERE key = 'target_companies'
  LIMIT 1;

  IF payload IS NOT NULL AND jsonb_typeof(payload) = 'array' THEN
    FOR item IN SELECT jsonb_array_elements_text(payload) LOOP
      IF item IS NOT NULL AND length(trim(item)) > 0 THEN
        INSERT INTO scope_companies (name)
        VALUES (trim(item))
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END $$;

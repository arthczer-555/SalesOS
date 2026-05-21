-- Ajout du lien vers HubSpot Company (résolu en lazy à la première demande
-- de hubspot_recap depuis la Watch List), et cache du slug LinkedIn Netrows
-- utilisé pour récupérer les posts entreprise (évite de re-tester le slug
-- à chaque refresh news).

ALTER TABLE scope_companies
  ADD COLUMN IF NOT EXISTS hubspot_company_id TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linkedin_username TEXT;

CREATE INDEX IF NOT EXISTS scope_companies_hubspot_company_id_idx
  ON scope_companies (hubspot_company_id);

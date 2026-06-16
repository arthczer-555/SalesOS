-- Étend apollo_enrichment_jobs pour le flux Org Chart : quand un enrichissement
-- part d'une personne d'un organigramme, on relie le job à orgchart_people /
-- orgchart_accounts pour réécrire l'email + le hubspot_contact_id + in_hubspot
-- sur la ligne une fois l'email révélé (cf. lib/apollo/run-enrichment.ts).
-- Nullable : le chemin watchlist existant ne renseigne pas ces colonnes.

ALTER TABLE apollo_enrichment_jobs
  ADD COLUMN IF NOT EXISTS orgchart_person_id UUID,
  ADD COLUMN IF NOT EXISTS orgchart_account_id UUID;

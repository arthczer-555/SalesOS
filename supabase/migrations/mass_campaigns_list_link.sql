-- Lien liste d'enrichissement -> campagne, + lignage de relance.
-- Permet d'afficher "dernière campagne" par liste et de chaîner les relances.

ALTER TABLE mass_campaigns
  ADD COLUMN IF NOT EXISTS list_id            UUID REFERENCES enrichment_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_campaign_id UUID REFERENCES mass_campaigns(id)  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mass_campaigns_list ON mass_campaigns(list_id);

-- Fusion de deux fiches client qui sont le même compte (cf. lib/clients/merge.ts).
-- ────────────────────────────────────────────────────────────────────────
-- Un même client peut avoir deux rows : deux deals closed-won (renouvellement,
-- deal signé par une autre entité) ou deux companies HubSpot (ENGIE / Groupe
-- Engie). Chaque row ne voit alors qu'une partie du compte : l'une a l'activité
-- HubSpot, l'autre matche le sheet revenue. La fusion garde une row et absorbe
-- l'autre, qui est supprimée.
--
-- merged_deal_ids : deals des rows absorbées. Lus avec le deal principal
--   (contexte HubSpot, meetings Claap indexés), et comptés comme "déjà importés"
--   par le webhook closed-won et l'import historique (sinon la row absorbée
--   reviendrait au prochain passage). Index GIN pour le filtre overlaps.
--
-- merged_clients : trace des rows absorbées [{ id, hubspot_deal_id,
--   hubspot_company_id, company_name, closedwon_at, merged_at, merged_by,
--   snapshot }]. company_name sert au match du sheet revenue ; snapshot garde la
--   row absorbée entière pour pouvoir défaire une fusion à la main.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS merged_deal_ids TEXT[],
  ADD COLUMN IF NOT EXISTS merged_clients  JSONB;

CREATE INDEX IF NOT EXISTS idx_clients_merged_deal_ids ON clients USING GIN (merged_deal_ids);

-- Qualification KUNA de la fiche deal (deck "Deal Strategy Coachello"), produite
-- par le scoring IA (Rescore / Score all deals), cf lib/deals/kuna.ts :
--   kuna         : 10 entrées { key, status: K|U|N|A, evidence, source, action }
--   committee    : { members: [{ role, name, title, status: talked|known|unknown }], championIsGatekeeper }
--   go_live_date : date de go-live donnée par le prospect (base du retroplanning), null sinon
-- Écriture best-effort côté app (persistDealScore) : tant que ces colonnes
-- n'existent pas, le scoring continue et la fiche affiche "Rescore".

ALTER TABLE deal_scores
  ADD COLUMN IF NOT EXISTS kuna JSONB,
  ADD COLUMN IF NOT EXISTS committee JSONB,
  ADD COLUMN IF NOT EXISTS go_live_date DATE;

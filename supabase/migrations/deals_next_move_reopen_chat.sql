-- Fiche deal (2026-10-29) : Next move structuré, plan de relance des deals
-- perdus, chat coach ciblé sur un deal. Écritures best-effort côté app : tant
-- que ces colonnes n'existent pas, l'app garde l'ancien affichage.
--
-- deal_scores.next_move : { action, by, steps[], why } produit par le scoring
--   (lib/deals/kuna.ts sanitizeNextMove). next_action (texte) reste rempli
--   avec la version aplatie pour le briefing, le digest AE et les leads.
-- deal_loss_analyses.reopen_date / owner_id : date de relance suggérée par
--   l'analyse de perte et owner HubSpot du deal au moment de l'analyse, pour
--   trier la colonne Closed lost par date de relance (filtre owner inclus)
--   sans relire chaque deal dans HubSpot.
-- chat_jobs.deal_id : deal sur lequel porte une question CoachelloAI posée
--   depuis la fiche deal (brief du deal ajouté au system prompt).

ALTER TABLE deal_scores
  ADD COLUMN IF NOT EXISTS next_move JSONB;

ALTER TABLE deal_loss_analyses
  ADD COLUMN IF NOT EXISTS reopen_date DATE,
  ADD COLUMN IF NOT EXISTS owner_id TEXT;

CREATE INDEX IF NOT EXISTS idx_deal_loss_analyses_reopen
  ON deal_loss_analyses (reopen_date) WHERE status = 'done';

ALTER TABLE chat_jobs
  ADD COLUMN IF NOT EXISTS deal_id TEXT;

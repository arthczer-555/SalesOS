-- Refonte Watch List : la synthèse IA (ai_summary) devient l'analyse AE
-- (ae_analysis), et le récap HubSpot (hubspot_recap) n'est plus un brief affiché
-- (il devient un input interne de l'analyse AE). On met à jour la contrainte
-- CHECK sur kind et on purge les anciennes rows devenues obsolètes.

ALTER TABLE watchlist_company_briefs
  DROP CONSTRAINT IF EXISTS watchlist_company_briefs_kind_check;

DELETE FROM watchlist_company_briefs
  WHERE kind IN ('ai_summary', 'hubspot_recap');

ALTER TABLE watchlist_company_briefs
  ADD CONSTRAINT watchlist_company_briefs_kind_check
  CHECK (kind IN ('ae_analysis', 'news'));

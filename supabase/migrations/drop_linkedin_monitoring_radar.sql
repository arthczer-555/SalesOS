-- Suppression du backbone Radar / monitoring LinkedIn (Netrows).
--
-- ⚠️ DESTRUCTIF & IRRÉVERSIBLE. À exécuter manuellement après vérification.
-- Le code applicatif ne lit plus aucune de ces tables (vérifié : zéro reader).
--
-- Conservé volontairement (NE PAS dropper) :
--   - enrichment_lists      : réutilisé par la nouvelle page /lists
--   - linkedin_email_cache  : utilisé par findEmailByLinkedInCached (lib/netrows.ts, gardé)
--   - market_signals        : encore lu par la Watchlist (signals_30d) et les news

-- Profils monitorés "Radar" (changement de poste, champions, etc.)
DROP TABLE IF EXISTS linkedin_monitored_profiles CASCADE;

-- Jobs de recherche Netrows de l'ancienne page Enrichissement (+ colonne combo_logs)
DROP TABLE IF EXISTS netrows_search_jobs CASCADE;

-- Dédup d'idempotence du webhook Netrows (supprimé)
DROP TABLE IF EXISTS netrows_events_processed CASCADE;

-- Logs d'exécution de l'agent Market Intel "Job Change" (supprimé)
DROP TABLE IF EXISTS intel_agent_run_logs CASCADE;
DROP TABLE IF EXISTS intel_agent_runs CASCADE;

-- Colonnes Radar éventuelles sur scope_companies (si la migration de cleanup
-- scope_companies_drop_linkedin_radar.sql n'a pas déjà tout retiré)
ALTER TABLE scope_companies DROP COLUMN IF EXISTS radar_added_at;
ALTER TABLE scope_companies DROP COLUMN IF EXISTS radar_failed_reason;

-- Suppression des 9 signaux champion_change "bruit" générés pour Austin
-- le 2026-05-18 ~15:51 UTC (modif LinkedIn non matérielle : description/emoji/etc).

BEGIN;

-- 1) Contrôle.
SELECT COUNT(*) AS to_delete
FROM market_signals
WHERE signal_type = 'champion_change'
  AND source_url ILIKE '%austin%'
  AND created_at >= '2026-05-18 15:49:00+00'
  AND created_at <  '2026-05-18 15:53:00+00';

-- 2) Aperçu.
SELECT id, created_at, user_id, title
FROM market_signals
WHERE signal_type = 'champion_change'
  AND source_url ILIKE '%austin%'
  AND created_at >= '2026-05-18 15:49:00+00'
  AND created_at <  '2026-05-18 15:53:00+00'
ORDER BY created_at, user_id;

-- 3) Suppression.
DELETE FROM market_signals
WHERE signal_type = 'champion_change'
  AND source_url ILIKE '%austin%'
  AND created_at >= '2026-05-18 15:49:00+00'
  AND created_at <  '2026-05-18 15:53:00+00';

-- 4) Lance à la main :
--    COMMIT;     -- pour valider
--    ROLLBACK;   -- pour annuler

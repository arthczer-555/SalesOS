-- Suppression des market_signals (intels) créés le 2026-05-12.
-- À exécuter dans Supabase SQL Editor.
-- created_at est en TIMESTAMPTZ : on filtre sur la journée locale via une plage [00:00, 24:00).

BEGIN;

-- 1) Contrôle : combien de lignes seront supprimées ?
SELECT COUNT(*) AS to_delete
FROM market_signals
WHERE created_at >= '2026-05-12 00:00:00+00'
  AND created_at <  '2026-05-13 00:00:00+00';

-- 2) Aperçu (10 premières lignes) pour vérifier visuellement.
SELECT id, created_at, agent_id, score, title
FROM market_signals
WHERE created_at >= '2026-05-12 00:00:00+00'
  AND created_at <  '2026-05-13 00:00:00+00'
ORDER BY created_at
LIMIT 10;

-- 3) Suppression.
DELETE FROM market_signals
WHERE created_at >= '2026-05-12 00:00:00+00'
  AND created_at <  '2026-05-13 00:00:00+00';

-- 4) Vérifie le compte ci-dessus, puis lance manuellement l'un des deux :
--    COMMIT;     -- pour valider la suppression
--    ROLLBACK;   -- pour annuler
--
-- NB : tant que tu n'as pas lancé COMMIT/ROLLBACK, la transaction reste ouverte.

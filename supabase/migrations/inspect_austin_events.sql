-- 1) Les event_keys d'Austin contiennent-ils 'position' ou 'headline' ?
SELECT
  COUNT(*) AS total_austin_events,
  COUNT(*) FILTER (WHERE event_key ILIKE '%:position:%') AS with_position,
  COUNT(*) FILTER (WHERE event_key ILIKE '%:headline:%') AS with_headline,
  COUNT(*) FILTER (WHERE event_key NOT ILIKE '%:position:%' AND event_key NOT ILIKE '%:headline:%') AS without_either
FROM netrows_events_processed
WHERE event_key ILIKE '%austin%';

-- 2) Pour chaque event Austin, croisé avec les signaux créés à ~la même heure.
--    Si signaux existent pour des events SANS position/headline → bug confirmé.
SELECT
  n.processed_at,
  CASE WHEN n.event_key ILIKE '%:position:%' THEN 'yes' ELSE 'no' END AS has_position,
  CASE WHEN n.event_key ILIKE '%:headline:%' THEN 'yes' ELSE 'no' END AS has_headline,
  (
    SELECT COUNT(*) FROM market_signals ms
    WHERE ms.signal_type = 'champion_change'
      AND ms.source_url ILIKE '%austin%'
      AND ms.created_at BETWEEN n.processed_at - INTERVAL '2 minutes'
                            AND n.processed_at + INTERVAL '2 minutes'
  ) AS signals_around_this_event
FROM netrows_events_processed n
WHERE n.event_key ILIKE '%austin%'
ORDER BY n.processed_at DESC
LIMIT 20;

-- 3) Voir les 3 plus longs event_keys d'Austin (entier, pas tronqué côté UI).
--    Note : le champ est text donc pas de limite SQL — c'est l'UI qui tronque.
SELECT LENGTH(event_key) AS len, event_key
FROM netrows_events_processed
WHERE event_key ILIKE '%austin%'
ORDER BY len DESC
LIMIT 3;

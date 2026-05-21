-- Diagnostic v3 : on a vu nb_signals(12 mai UTC) = 0 et profile full_name = email.
-- On cherche maintenant quand ces lignes Austin ont vraiment été créées.

-- A) Tous les signaux qui mentionnent Austin, peu importe la date.
SELECT id, created_at, user_id, signal_type, title, company_name, source_url
FROM market_signals
WHERE title ILIKE '%austin%'
   OR source_url ILIKE '%austin%'
   OR company_name ILIKE '%adyen%'
ORDER BY created_at DESC
LIMIT 30;

-- B) Histogramme par jour (UTC) des signaux récents : voit-on un pic le 12 ou 13 mai ?
SELECT date_trunc('day', created_at) AS day_utc, COUNT(*)
FROM market_signals
WHERE created_at >= '2026-05-10 00:00:00+00'
GROUP BY day_utc
ORDER BY day_utc;

-- C) Histogramme par jour en TZ Europe/Paris (au cas où le décalage explique).
SELECT date_trunc('day', created_at AT TIME ZONE 'Europe/Paris') AS day_paris, COUNT(*)
FROM market_signals
WHERE created_at >= '2026-05-10 00:00:00+00'
GROUP BY day_paris
ORDER BY day_paris;

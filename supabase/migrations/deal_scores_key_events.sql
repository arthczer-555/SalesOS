-- Événements clés datés extraits par le scoring IA (Rescorer / Scorer tous les
-- deals), affichés dans la timeline de la fiche deal. Chaque entrée :
--   { date: "YYYY-MM-DD", label, type, description }
-- L'écriture côté app est best-effort : tant que cette colonne n'existe pas,
-- le scoring continue de fonctionner (les events ne sont juste pas persistés).

ALTER TABLE deal_scores
  ADD COLUMN IF NOT EXISTS key_events JSONB;

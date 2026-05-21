-- Diagnostic per-combo : URL appelée, HTTP status, items renvoyés, erreur.
-- Permet à l'UI d'afficher pourquoi tel combo a renvoyé 0 profils (404
-- silencieux, rate-limit, caractère spécial, etc.) au lieu d'un mystère.
ALTER TABLE netrows_search_jobs
  ADD COLUMN IF NOT EXISTS combo_logs JSONB;

-- Permet user_id = NULL pour tracker les appels Claude système (cron,
-- webhooks, résolveurs internes) qui n'ont pas de user authentifié.
-- Avant ce fix, logUsage retournait silencieusement quand userId était null,
-- ce qui a rendu invisible un cron de scoring (~100 appels Haiku, ~6 EUR)
-- dans l'admin pendant qu'il facturait.

ALTER TABLE usage_logs
  ALTER COLUMN user_id DROP NOT NULL;

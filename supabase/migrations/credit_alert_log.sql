-- Anti-spam des alertes Slack "crédit épuisé" (lib/credit-alert.ts).
--
-- Le throttle vivait en mémoire du process : chaque invocation serverless et
-- chaque script local repartait de zéro, d'où 4 DM identiques "Bright Data"
-- en 1h20 le 2026-07-29. Une ligne par fournisseur, partagée par tous les
-- process, ramène ça à 1 alerte / 24h.
--
-- La revendication du créneau est atomique côté Postgres :
--   UPDATE ... WHERE last_alert_at < now() - 24h  -> 1 ligne = droit d'alerter
--   INSERT en conflit (23505)                     -> quelqu'un a déjà alerté

CREATE TABLE IF NOT EXISTS credit_alert_log (
  provider text PRIMARY KEY,
  last_alert_at timestamptz NOT NULL DEFAULT now()
);

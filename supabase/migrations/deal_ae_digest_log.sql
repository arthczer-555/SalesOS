-- Journal d'envoi du digest "deal review" par AE (un DM Slack par owner à la fin
-- du run de scoring, cf. lib/deals/ae-digest.ts). Sert deux choses :
--   1. Idempotence : (owner_id, run_date) unique => un retry du cron le même jour
--      ne re-DM pas un AE déjà notifié (même logique que owner_notified_at côté
--      clients).
--   2. Audit : on garde le ts/canal Slack et le nombre de deals envoyés.
CREATE TABLE IF NOT EXISTS deal_ae_digest_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id      TEXT        NOT NULL,
  run_date      DATE        NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deal_count    INT         NOT NULL DEFAULT 0,
  recipient     TEXT,        -- email ou nom du destinataire résolu (audit)
  slack_ts      TEXT,
  slack_channel TEXT,
  UNIQUE (owner_id, run_date)
);

-- Pot d'équipe 2026 ("The Coachello Pot", page /pot, lib/team-pot/).
-- La synchro horaire relit l'onglet Factures du classeur revenue et écrit ici.

-- Paliers atteints, figés à la première détection : un palier n'est jamais
-- retiré, et "qui l'a franchi" ne bouge plus même si le classeur est corrigé.
CREATE TABLE IF NOT EXISTS team_pot_milestones (
  level          INT         PRIMARY KEY,          -- 2200000, 2250000, ...
  bonus          INT         NOT NULL,             -- 1000 ou 2000 (accélérateur)
  reached_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_at_reach NUMERIC     NOT NULL,
  crossed_by     JSONB                              -- { company, owner, amount, date, isAi, aiBonus }
);

-- Un snapshot par jour (heure de Paris), écrasé à chaque synchro du jour.
-- payload = état complet (lib/team-pot/compute.ts PotState), lu par la page
-- et l'outil get_team_pot.
CREATE TABLE IF NOT EXISTS team_pot_snapshots (
  day       DATE        PRIMARY KEY,
  total     NUMERIC     NOT NULL,
  pot       NUMERIC     NOT NULL,
  payload   JSONB       NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Journal des messages Slack, sert d'idempotence : la clé est réservée avant
-- l'envoi et supprimée si Slack échoue. Clés préfixées par le mode :
-- "prod:milestone:2200000", "prod:weekly:2026-11-02", "prod:final".
-- payload (récap du lundi) = état au moment de l'envoi, base du récap suivant.
CREATE TABLE IF NOT EXISTS team_pot_messages (
  key      TEXT        PRIMARY KEY,
  slack_ts TEXT,
  payload  JSONB,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

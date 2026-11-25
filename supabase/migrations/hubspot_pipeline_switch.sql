-- Bascule HubSpot du 30/11/2026 : deux pipelines de deals (Prospection puis
-- Sales), score écrit dans HubSpot, passage R1 scheduled -> Scoping, demandes
-- de confirmation Slack, analyse de perte automatique.
-- Plan complet : __documentation/hubspot-pipeline-switch-plan.md
--
-- Idempotente : peut être rejouée sans risque. À appliquer AVANT le premier
-- déploiement du code qui s'en sert : les écritures HubSpot gardées
-- (lib/hubspot/deal-writes.ts) refusent d'écrire tant que hubspot_write_log
-- n'existe pas ("pas de ligne de journal, pas d'écriture").

-- ── 1. Journal des écritures HubSpot gardées ────────────────────────────────
-- Une ligne par écriture automatique : ouverte en 'pending' AVANT l'appel
-- HubSpot, close en 'done' ou 'failed' après. dedupe_key sert de réservation
-- (ex. "r1_to_scoping:<deal>:<date d'entrée en étape>") : deux traitements du
-- même meeting ne déplacent pas deux fois la carte. Elle est remise à NULL si
-- l'écriture échoue, pour libérer la réservation en gardant la trace.
CREATE TABLE IF NOT EXISTS hubspot_write_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  action       TEXT        NOT NULL,   -- create_deal | r1_to_scoping | score | type_offre | loss_category | reactivation | contact_unqualified | create_contact | create_company
  object_type  TEXT        NOT NULL,   -- deals | contacts | companies
  object_id    TEXT,                   -- NULL tant que l'objet n'est pas créé
  dedupe_key   TEXT        UNIQUE,
  triggered_by TEXT        NOT NULL,   -- lead_validation | claap_call | confirmation | test_script
  actor        TEXT,                   -- utilisateur (id ou email) ou "system"
  mode         TEXT,                   -- valeur du réglage au moment de l'écriture (test, on, on_new...)
  is_test      BOOLEAN     NOT NULL DEFAULT false,
  before_value JSONB,
  after_value  JSONB,
  status       TEXT        NOT NULL DEFAULT 'pending',   -- pending | done | failed
  error        TEXT,
  lead_id      UUID,
  analysis_id  UUID,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hubspot_write_log_object ON hubspot_write_log (object_type, object_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hubspot_write_log_action ON hubspot_write_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hubspot_write_log_lead   ON hubspot_write_log (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hubspot_write_log_test   ON hubspot_write_log (created_at DESC) WHERE is_test;

-- ── 2. leads : motif de rejet et faits de la validation ─────────────────────
-- Les faits de la validation (carte, contact, email saisi, Source) vivent sur
-- `leads` et plus sur la ligne d'analyse : celle-ci est remplacée à chaque
-- ré-analyse, ce qui faisait perdre la carte d'un lead déjà validé.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS reject_reason       TEXT,
  ADD COLUMN IF NOT EXISTS reject_note         TEXT,
  ADD COLUMN IF NOT EXISTS rejected_hubspot_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hubspot_deal_id     TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_contact_id  TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_company_id  TEXT,
  ADD COLUMN IF NOT EXISTS contact_email       TEXT,        -- l'email saisi à la validation
  ADD COLUMN IF NOT EXISTS deal_link_origin    TEXT,        -- created | linked
  ADD COLUMN IF NOT EXISTS deal_origin         TEXT,        -- propriété HubSpot `origin` (Source)
  ADD COLUMN IF NOT EXISTS offer_types         TEXT[],
  ADD COLUMN IF NOT EXISTS referring_partner   TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_contact_email ON leads (lower(contact_email)) WHERE contact_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_hubspot_deal  ON leads (hubspot_deal_id) WHERE hubspot_deal_id IS NOT NULL;

-- Offres relevées par l'analyse du lead, avec la citation qui les justifie.
ALTER TABLE lead_analyses
  ADD COLUMN IF NOT EXISTS offer_types       TEXT[],
  ADD COLUMN IF NOT EXISTS offer_types_quote TEXT;

-- ── 3. sales_coach_analyses : rapprochement meeting <-> carte ───────────────
ALTER TABLE sales_coach_analyses
  ADD COLUMN IF NOT EXISTS deal_match_method TEXT,          -- claap_link | lead_manager | participant_email | company_domain | deal_name | company_name | llm_title | llm_summary | manual_link | confirmed
  ADD COLUMN IF NOT EXISTS deal_match_detail JSONB,
  ADD COLUMN IF NOT EXISTS presence_verdict  TEXT,          -- attended | external | internal | unsure
  ADD COLUMN IF NOT EXISTS stage_moved_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stage_move_result TEXT,
  ADD COLUMN IF NOT EXISTS score_global_v1   NUMERIC;       -- ancienne note du call, gardée au recalcul (lot 4)

-- ── 4. deal_scores : score v2 en ombre et synchro HubSpot ───────────────────
ALTER TABLE deal_scores
  ADD COLUMN IF NOT EXISTS score_v2           JSONB,
  ADD COLUMN IF NOT EXISTS score_v1           JSONB,
  ADD COLUMN IF NOT EXISTS score_model        TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_score      INT,
  ADD COLUMN IF NOT EXISTS hubspot_synced_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hubspot_sync_error TEXT;

CREATE TABLE IF NOT EXISTS deal_score_history (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         TEXT        NOT NULL,
  scored_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  score           INT         NOT NULL,
  band            TEXT,                  -- low | medium | high | qualified
  score_model     TEXT,                  -- v1 | v2
  triggered_by    TEXT,                  -- claap_call | manual | cron | test_script
  analysis_id     UUID,
  hubspot_written BOOLEAN     NOT NULL DEFAULT false,
  detail          JSONB
);
CREATE INDEX IF NOT EXISTS idx_deal_score_history_deal ON deal_score_history (deal_id, scored_at DESC);

-- ── 5. Demandes de confirmation Slack (✅ / ❌) ──────────────────────────────
-- Une ligne par message envoyé. Plusieurs messages peuvent porter la même
-- demande (plusieurs Coachello présents au meeting) : request_key est commune,
-- la première réponse ferme les autres. `proposed` fige ce que le ✅ écrira
-- (date et owner de réactivation, par exemple). Une demande émise en mode test
-- est à blanc : un ✅ n'écrit rien sur une vraie carte.
CREATE TABLE IF NOT EXISTS slack_confirmations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind             TEXT        NOT NULL,   -- r1_move | deal_link | reactivation
  request_key      TEXT        NOT NULL,
  slack_channel    TEXT,
  slack_ts         TEXT,
  slack_user_id    TEXT,                   -- destinataire réel du message
  intended_user_id TEXT,                   -- destinataire théorique (différent en mode test)
  mode             TEXT        NOT NULL DEFAULT 'test',     -- test | live
  analysis_id      UUID,
  deal_id          TEXT,
  proposed         JSONB,
  status           TEXT        NOT NULL DEFAULT 'pending',  -- pending | received | done | failed | expired | superseded
  expires_at       TIMESTAMPTZ,
  answer           TEXT,                   -- yes | no
  answered_by      TEXT,
  answered_at      TIMESTAMPTZ,
  result           JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_confirmations_message ON slack_confirmations (slack_channel, slack_ts) WHERE slack_ts IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slack_confirmations_request  ON slack_confirmations (request_key);
CREATE INDEX IF NOT EXISTS idx_slack_confirmations_pending  ON slack_confirmations (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_slack_confirmations_deal     ON slack_confirmations (deal_id, kind) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_slack_confirmations_analysis ON slack_confirmations (analysis_id) WHERE analysis_id IS NOT NULL;

-- ── 6. Alertes et relais Slack sur les deals (lot 3) ────────────────────────
-- Idempotence par clé réservée avant l'envoi, comme team_pot_messages.
CREATE TABLE IF NOT EXISTS deal_alert_log (
  key      TEXT        PRIMARY KEY,
  rule     TEXT        NOT NULL,
  deal_id  TEXT,
  owner_id TEXT,
  slack_ts TEXT,
  payload  JSONB,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_alert_log_deal ON deal_alert_log (deal_id, sent_at DESC);

-- ── 7. Analyse de perte automatique et réactivation (lot 3) ─────────────────
-- lost_at : entrée dans l'étape perdue. La clé d'une analyse devient
-- (deal_id, lost_at) : un deal rouvert puis reperdu est réanalysé. Le statut
-- gagne la valeur 'queued' (perte inscrite par le webhook, pas encore analysée).
ALTER TABLE deal_loss_analyses
  ADD COLUMN IF NOT EXISTS lost_at                    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hubspot_category           TEXT,
  ADD COLUMN IF NOT EXISTS category_written_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopen_source              TEXT,     -- rep | analysis | default | salesos
  ADD COLUMN IF NOT EXISTS reactivation_written_value JSONB,
  ADD COLUMN IF NOT EXISTS reactivation_written_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error                 TEXT,
  ADD COLUMN IF NOT EXISTS trigger_source             TEXT;     -- click | webhook | reconcile | batch
CREATE INDEX IF NOT EXISTS idx_deal_loss_analyses_queue ON deal_loss_analyses (status, lost_at) WHERE status IN ('queued', 'error', 'analyzing');

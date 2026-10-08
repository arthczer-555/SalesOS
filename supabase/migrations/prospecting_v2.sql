-- Prospecting v2 : campagnes multi-étapes (séquences), prospects dédupliqués à
-- l'échelle de l'équipe, envois Gmail planifiés par un cron, détection des
-- réponses / bounces, tâches manuelles (LinkedIn, appels), inbox.
--
-- Remplace fonctionnellement /prospecting (single) et /mass-prospection.
-- Les tables mass_campaigns / mass_campaign_emails restent en lecture seule
-- (aucune migration de données). Chaque email envoyé est aussi journalisé dans
-- outreach_log (source = 'prospecting') pour les badges "X exchanges".
--
-- Idempotente : peut être rejouée sans effet de bord.

-- ── 1. Personas (cibles) ───────────────────────────────────────────────────
-- Éditables dans Playbook > Personas. Seed fait côté code (DEFAULT_PERSONAS,
-- lib/prospecting/personas.ts) au premier chargement si la table est vide.
CREATE TABLE IF NOT EXISTS prospecting_personas (
  id          TEXT PRIMARY KEY,                       -- 'hr_ld', 'sales_leaders', ou slug custom
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- { titles[], excludeTitles[], seniorities[], departments[], companySizes[], industries[], locations[], hiringTitles[] }
  targeting   JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { pains[], valueProps[], proofPoints[{text,source}], insights[{text,source}], objections[{objection,answer}],
  --   competitors[], ctas[], tone, examples[], knowledgePages[] }
  messaging   JSONB NOT NULL DEFAULT '{}'::jsonb,
  color       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  position    INT NOT NULL DEFAULT 0,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Connaissance Coachello (snapshot Notion + packs RAG) ────────────────
-- Source de vérité = Notion. On en garde une copie pour ne pas dépendre de
-- l'API Notion à chaque génération, rafraîchie via "Sync from Notion".
CREATE TABLE IF NOT EXISTS prospecting_knowledge (
  id         TEXT PRIMARY KEY,                        -- id de page Notion, ou 'rag:<slug>'
  kind       TEXT NOT NULL CHECK (kind IN ('notion', 'rag')),
  title      TEXT NOT NULL,
  url        TEXT,
  content    TEXT NOT NULL DEFAULT '',
  error      TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Templates de séquence sauvegardés par les users ─────────────────────
-- Les templates système sont en code (lib/prospecting/templates.ts).
CREATE TABLE IF NOT EXISTS prospecting_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  persona_id  TEXT REFERENCES prospecting_personas(id) ON DELETE SET NULL,
  steps       JSONB NOT NULL DEFAULT '[]'::jsonb,     -- StepDraft[]
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospecting_templates_user_idx ON prospecting_templates (user_id, created_at DESC);

-- ── 4. Boîte d'envoi (1 par user) + état de synchro + verrou du tick ───────
CREATE TABLE IF NOT EXISTS prospecting_mailboxes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- 'gmail' = connexion Google principale ; 'gmail_sender' = boîte dédiée à la
  -- prospection (domaine secondaire recommandé pour protéger coachello.io).
  provider        TEXT NOT NULL DEFAULT 'gmail' CHECK (provider IN ('gmail', 'gmail_sender')),
  email_address   TEXT,
  from_name       TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Europe/Paris',
  daily_limit     INT NOT NULL DEFAULT 30 CHECK (daily_limit BETWEEN 1 AND 100),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disconnected')),
  paused_reason   TEXT,                               -- manual | gmail_auth | gmail_quota | bounce_guard
  paused_until    TIMESTAMPTZ,
  last_history_id TEXT,                               -- curseur Gmail History API
  last_synced_at  TIMESTAMPTZ,
  sync_error      TEXT,
  lease_until     TIMESTAMPTZ,                        -- un seul tick à la fois par boîte
  lease_owner     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. Campagnes ───────────────────────────────────────────────────────────
-- settings : cf. CampaignSettings (lib/prospecting/settings.ts), normalisé en code.
CREATE TABLE IF NOT EXISTS prospecting_campaigns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- owner = expéditeur
  name           TEXT NOT NULL,
  persona_id     TEXT REFERENCES prospecting_personas(id) ON DELETE SET NULL,
  goal           TEXT NOT NULL DEFAULT '',
  instructions   TEXT NOT NULL DEFAULT '',
  language       TEXT NOT NULL DEFAULT 'auto' CHECK (language IN ('auto', 'en', 'fr')),
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  pause_reason   TEXT,
  settings       JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_list_id UUID,                                -- enrichment_lists.id si créée depuis une liste
  launched_at    TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- kind : 'sequence' = vraie campagne ; 'quick' = lot d'emails ponctuels (outil
-- Quick email, une seule étape), caché de la liste des campagnes mais qui
-- réutilise le moteur d'envoi et la détection des réponses.
ALTER TABLE prospecting_campaigns ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'sequence';
DO $$ BEGIN
  ALTER TABLE prospecting_campaigns ADD CONSTRAINT prospecting_campaigns_kind_check CHECK (kind IN ('sequence', 'quick'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS prospecting_campaigns_user_idx ON prospecting_campaigns (user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS prospecting_campaigns_kind_idx ON prospecting_campaigns (user_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS prospecting_campaigns_list_idx ON prospecting_campaigns (source_list_id) WHERE source_list_id IS NOT NULL;

-- ── 6. Étapes de séquence (linéaires en v1) ────────────────────────────────
CREATE TABLE IF NOT EXISTS prospecting_steps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES prospecting_campaigns(id) ON DELETE CASCADE,
  position    INT NOT NULL CHECK (position >= 1),
  kind        TEXT NOT NULL CHECK (kind IN ('email', 'linkedin_visit', 'linkedin_invite', 'linkedin_message', 'call', 'task')),
  -- Jours d'envoi (jours ouvrés activés dans la fenêtre) après l'étape précédente.
  delay_days  INT NOT NULL DEFAULT 0 CHECK (delay_days BETWEEN 0 AND 60),
  thread_mode TEXT NOT NULL DEFAULT 'new' CHECK (thread_mode IN ('new', 'reply')),
  -- { mode:'ai'|'template', angle, instructions, template:{subject,body}, length, cta, waitForCompletion }
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  version     INT NOT NULL DEFAULT 1,                 -- +1 à chaque modif de contenu -> touches outdated
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospecting_steps_campaign_idx ON prospecting_steps (campaign_id, position);

-- ── 7. Prospects : registre d'équipe dédupliqué + cache de recherche ───────
CREATE TABLE IF NOT EXISTS prospecting_contacts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT,
  email_lower        TEXT GENERATED ALWAYS AS (LOWER(email)) STORED,
  email_status       TEXT,                            -- verified | guessed | unverified | invalid | bounced
  first_name         TEXT NOT NULL DEFAULT '',
  last_name          TEXT NOT NULL DEFAULT '',
  title              TEXT,
  seniority          TEXT,
  company_name       TEXT,
  company_domain     TEXT,
  linkedin_url       TEXT,
  linkedin_username  TEXT,
  phone              TEXT,
  location           TEXT,
  country            TEXT,
  industry           TEXT,
  company_size       TEXT,
  persona_id         TEXT REFERENCES prospecting_personas(id) ON DELETE SET NULL,
  hubspot_contact_id TEXT,
  hubspot_company_id TEXT,
  scope_company_id   UUID,
  apollo_id          TEXT,
  source             TEXT NOT NULL,                   -- apollo | hubspot | csv | manual | list | watchlist | linkedin | referral
  custom_fields      JSONB NOT NULL DEFAULT '{}'::jsonb, -- colonnes CSV -> {{custom.x}}
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
                       'new', 'in_sequence', 'replied', 'interested', 'meeting', 'not_interested',
                       'bounced', 'unsubscribed', 'do_not_contact')),
  research           JSONB,                           -- ContactResearch (brief + sources)
  research_at        TIMESTAMPTZ,
  research_error     TEXT,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS prospecting_contacts_email_uniq ON prospecting_contacts (email_lower) WHERE email_lower IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS prospecting_contacts_linkedin_uniq ON prospecting_contacts (LOWER(linkedin_username)) WHERE linkedin_username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS prospecting_contacts_apollo_uniq ON prospecting_contacts (apollo_id) WHERE apollo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prospecting_contacts_domain_idx ON prospecting_contacts (company_domain);
CREATE INDEX IF NOT EXISTS prospecting_contacts_hubspot_idx ON prospecting_contacts (hubspot_contact_id);
CREATE INDEX IF NOT EXISTS prospecting_contacts_created_by_idx ON prospecting_contacts (created_by, created_at DESC);

-- ── 8. Cache de recherche entreprise (partagé, TTL 14 j appliqué en code) ──
CREATE TABLE IF NOT EXISTS prospecting_company_research (
  key          TEXT PRIMARY KEY,                      -- domaine normalisé, sinon 'name:<slug>'
  company_name TEXT,
  domain       TEXT,
  data         JSONB NOT NULL,                        -- CompanyResearch
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 9. Inscriptions (prospect x campagne) = machine à états de la séquence ─
CREATE TABLE IF NOT EXISTS prospecting_enrollments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES prospecting_campaigns(id) ON DELETE CASCADE,
  contact_id       UUID NOT NULL REFERENCES prospecting_contacts(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- dénormalisé (owner campagne)
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                     'pending', 'active', 'paused', 'replied', 'completed', 'bounced',
                     'unsubscribed', 'stopped', 'error')),
  outcome          TEXT CHECK (outcome IN ('interested', 'not_now', 'not_interested', 'meeting_booked', 'wrong_person')),
  content_status   TEXT NOT NULL DEFAULT 'none' CHECK (content_status IN ('none', 'queued', 'generating', 'ready', 'error', 'outdated')),
  content_error    TEXT,
  approved_at      TIMESTAMPTZ,
  approved_by      UUID,
  current_position INT NOT NULL DEFAULT 0,            -- dernière étape exécutée
  next_run_at      TIMESTAMPTZ,                       -- prochaine étape due (UTC)
  paused_until     TIMESTAMPTZ,
  pause_reason     TEXT,
  stop_reason      TEXT,
  started_at       TIMESTAMPTZ,                       -- 1re étape exécutée
  last_activity_at TIMESTAMPTZ,
  replied_at       TIMESTAMPTZ,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);
-- Un prospect ne peut être "en séquence" que dans UNE campagne de toute l'équipe.
CREATE UNIQUE INDEX IF NOT EXISTS prospecting_enrollments_live_uniq
  ON prospecting_enrollments (contact_id) WHERE status IN ('active', 'paused');
CREATE INDEX IF NOT EXISTS prospecting_enrollments_due_idx
  ON prospecting_enrollments (user_id, next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS prospecting_enrollments_campaign_idx ON prospecting_enrollments (campaign_id, status);
CREATE INDEX IF NOT EXISTS prospecting_enrollments_contact_idx ON prospecting_enrollments (contact_id);

-- ── 10. Touches = exécution d'une étape pour un prospect ───────────────────
CREATE TABLE IF NOT EXISTS prospecting_touches (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id          UUID NOT NULL REFERENCES prospecting_enrollments(id) ON DELETE CASCADE,
  step_id                UUID NOT NULL REFERENCES prospecting_steps(id) ON DELETE CASCADE,
  campaign_id            UUID NOT NULL,              -- dénormalisé
  user_id                UUID NOT NULL,              -- dénormalisé
  kind                   TEXT NOT NULL,
  position               INT NOT NULL,
  subject                TEXT,
  body                   TEXT,                       -- email / note LinkedIn / script d'appel
  previous_versions      JSONB NOT NULL DEFAULT '[]'::jsonb, -- 5 dernières versions {subject,body,at}
  generated_step_version INT,
  edited_by_user         BOOLEAN NOT NULL DEFAULT FALSE,
  lint                   JSONB,
  provenance             JSONB,
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                           'draft', 'approved', 'sending', 'sent', 'due', 'done', 'skipped', 'canceled', 'failed')),
  due_at                 TIMESTAMPTZ,
  snoozed_until          TIMESTAMPTZ,
  attempts               INT NOT NULL DEFAULT 0,
  last_error             TEXT,
  claim_id               UUID,
  claimed_at             TIMESTAMPTZ,
  sent_at                TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  task_outcome           TEXT,
  task_note              TEXT,
  gmail_message_id       TEXT,
  gmail_thread_id        TEXT,
  rfc_message_id         TEXT,
  hubspot_engagement_id  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, step_id)                    -- anti double-touch
);
CREATE INDEX IF NOT EXISTS prospecting_touches_thread_idx ON prospecting_touches (user_id, gmail_thread_id) WHERE gmail_thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prospecting_touches_sent_idx ON prospecting_touches (user_id, sent_at) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS prospecting_touches_tasks_idx ON prospecting_touches (user_id, status, due_at) WHERE kind <> 'email';
CREATE INDEX IF NOT EXISTS prospecting_touches_sending_idx ON prospecting_touches (claimed_at) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS prospecting_touches_step_idx ON prospecting_touches (step_id, status);

-- ── 11. Réponses / auto-réponses / bounces (Inbox) ─────────────────────────
CREATE TABLE IF NOT EXISTS prospecting_replies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrollment_id    UUID REFERENCES prospecting_enrollments(id) ON DELETE CASCADE,
  contact_id       UUID,
  campaign_id      UUID,
  touch_id         UUID,                              -- dernier email envoyé avant la réponse (attribution)
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id  TEXT,
  rfc_message_id   TEXT,
  from_email       TEXT,
  from_name        TEXT,
  subject          TEXT,
  snippet          TEXT,
  body             TEXT,
  received_at      TIMESTAMPTZ NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('reply', 'auto_reply', 'bounce', 'colleague_reply')),
  -- interested | question | not_now | not_interested | wrong_person | unsubscribe | out_of_office
  -- | bounce_hard | bounce_soft | other
  category         TEXT,
  confidence       NUMERIC,
  summary          TEXT,
  ai               JSONB,                             -- { oooReturnDate, referral, followUpDate, suggestedAction, language }
  classified_at    TIMESTAMPTZ,
  classify_error   TEXT,
  handled_at       TIMESTAMPTZ,
  handled_by       UUID,
  hubspot_engagement_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, gmail_message_id)
);
CREATE INDEX IF NOT EXISTS prospecting_replies_inbox_idx ON prospecting_replies (user_id, handled_at, received_at DESC);
CREATE INDEX IF NOT EXISTS prospecting_replies_touch_idx ON prospecting_replies (touch_id);
CREATE INDEX IF NOT EXISTS prospecting_replies_campaign_idx ON prospecting_replies (campaign_id, kind);

-- ── 12. Journal d'événements (timeline prospect + reporting) ───────────────
CREATE TABLE IF NOT EXISTS prospecting_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID,
  campaign_id   UUID,
  enrollment_id UUID,
  contact_id    UUID,
  touch_id      UUID,
  -- enrolled | generated | approved | sent | send_failed | task_due | task_done | task_skipped | replied
  -- | auto_replied | bounced | classified | paused | resumed | stopped | completed | meeting_booked
  -- | hubspot_logged | hubspot_failed | blocked | error
  type          TEXT NOT NULL,
  step_position INT,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospecting_events_campaign_idx ON prospecting_events (campaign_id, type, occurred_at);
CREATE INDEX IF NOT EXISTS prospecting_events_enrollment_idx ON prospecting_events (enrollment_id, occurred_at);
CREATE INDEX IF NOT EXISTS prospecting_events_contact_idx ON prospecting_events (contact_id, occurred_at);

-- ── 13. Liste de suppression (équipe) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospecting_suppressions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN ('email', 'domain')),
  value           TEXT NOT NULL,                      -- en minuscules
  reason          TEXT NOT NULL,                      -- unsubscribe | bounce | manual | customer | competitor
  note            TEXT,
  source_reply_id UUID,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);

-- ── 14. Jobs background (génération, recherche, reveal Apollo, résolution LinkedIn) ─
CREATE TABLE IF NOT EXISTS prospecting_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID,
  kind        TEXT NOT NULL CHECK (kind IN ('generate', 'research', 'apollo_reveal', 'linkedin_resolve')),
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error', 'canceled')),
  params      JSONB NOT NULL DEFAULT '{}'::jsonb,
  progress    JSONB NOT NULL DEFAULT '{"total":0,"done":0,"errors":0}'::jsonb,
  result      JSONB,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS prospecting_jobs_user_idx ON prospecting_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prospecting_jobs_campaign_idx ON prospecting_jobs (campaign_id, status);

-- ── Vues d'agrégats (PostgREST n'a pas de GROUP BY) ────────────────────────
-- Conventions de mesure (cf. README) :
--   contacted  = au moins un email envoyé
--   replied    = réponse humaine (auto-réponses et bounces exclus)
--   positive   = outcome interested ou meeting_booked
DROP VIEW IF EXISTS prospecting_campaign_stats;
CREATE VIEW prospecting_campaign_stats AS
SELECT
  c.id      AS campaign_id,
  c.user_id AS user_id,
  COUNT(e.id)::int                                                                        AS leads_total,
  COUNT(e.id) FILTER (WHERE e.status = 'pending')::int                                    AS leads_pending,
  COUNT(e.id) FILTER (WHERE e.status IN ('active', 'paused'))::int                        AS leads_active,
  COUNT(e.id) FILTER (WHERE COALESCE(tc.emails_sent, 0) > 0)::int                         AS leads_contacted,
  COUNT(e.id) FILTER (WHERE e.replied_at IS NOT NULL)::int                                AS leads_replied,
  COUNT(e.id) FILTER (WHERE e.outcome IN ('interested', 'meeting_booked'))::int           AS leads_positive,
  COUNT(e.id) FILTER (WHERE e.outcome = 'meeting_booked')::int                            AS leads_meetings,
  COUNT(e.id) FILTER (WHERE e.status = 'bounced')::int                                    AS leads_bounced,
  COUNT(e.id) FILTER (WHERE e.status = 'completed')::int                                  AS leads_completed,
  COUNT(e.id) FILTER (WHERE e.content_status = 'ready' AND e.approved_at IS NULL)::int    AS leads_to_review,
  COUNT(e.id) FILTER (WHERE e.content_status IN ('queued', 'generating'))::int            AS leads_generating,
  COUNT(e.id) FILTER (WHERE e.content_status = 'outdated')::int                           AS leads_outdated,
  COUNT(e.id) FILTER (WHERE e.content_status = 'none' AND e.status IN ('pending', 'active', 'paused'))::int AS leads_no_content,
  COUNT(e.id) FILTER (WHERE e.content_status = 'error' OR e.status = 'error')::int        AS leads_error,
  COUNT(e.id) FILTER (WHERE e.approved_at IS NOT NULL)::int                               AS leads_approved,
  COALESCE(SUM(tc.emails_sent), 0)::int                                                   AS emails_sent,
  COALESCE(SUM(tc.tasks_due), 0)::int                                                     AS tasks_due
FROM prospecting_campaigns c
LEFT JOIN prospecting_enrollments e ON e.campaign_id = c.id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE t.kind = 'email' AND t.status = 'sent') AS emails_sent,
    COUNT(*) FILTER (WHERE t.kind <> 'email' AND t.status = 'due')  AS tasks_due
  FROM prospecting_touches t
  WHERE t.enrollment_id = e.id
) tc ON TRUE
GROUP BY c.id, c.user_id;

DROP VIEW IF EXISTS prospecting_step_stats;
CREATE VIEW prospecting_step_stats AS
SELECT
  s.campaign_id,
  s.id       AS step_id,
  s.position,
  s.kind,
  (SELECT COUNT(*) FROM prospecting_touches t WHERE t.step_id = s.id AND t.status = 'sent')::int    AS sent,
  (SELECT COUNT(*) FROM prospecting_touches t WHERE t.step_id = s.id AND t.status = 'done')::int    AS done,
  (SELECT COUNT(*) FROM prospecting_touches t WHERE t.step_id = s.id AND t.status = 'due')::int     AS due,
  (SELECT COUNT(*) FROM prospecting_touches t WHERE t.step_id = s.id AND t.status = 'skipped')::int AS skipped,
  (SELECT COUNT(*) FROM prospecting_replies r JOIN prospecting_touches t ON t.id = r.touch_id
     WHERE t.step_id = s.id AND r.kind = 'reply')::int                                              AS replies,
  (SELECT COUNT(*) FROM prospecting_replies r JOIN prospecting_touches t ON t.id = r.touch_id
     WHERE t.step_id = s.id AND r.kind = 'bounce' AND r.category = 'bounce_hard')::int              AS bounces
FROM prospecting_steps s;

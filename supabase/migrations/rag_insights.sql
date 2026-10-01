-- ────────────────────────────────────────────────────────────────────────
-- RAG Insights (page admin /admin/rag)
--
-- Observabilité de CoachelloAI : qu'est-ce qu'on lui demande, est-ce qu'il
-- répond bien, et où la base Notion est trouée.
--
-- Les traces existent déjà (chat_jobs pour le web, slack_chat_threads pour
-- Slack) : rien de nouveau n'est instrumenté côté chat, on les relit. Ce
-- fichier ajoute (1) le feedback explicite 👍/👎 sur une réponse web,
-- (2) le cache d'analyse par tour, (3) les rapports de gaps Notion,
-- (4) la meta singleton de l'état du run.
-- ────────────────────────────────────────────────────────────────────────

-- 1) Feedback explicite sur une réponse du chat web (une row chat_jobs = un tour).
ALTER TABLE chat_jobs ADD COLUMN IF NOT EXISTS feedback TEXT;      -- 'up' | 'down'
ALTER TABLE chat_jobs ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ;

-- 2) Une row = un tour (question -> réponse) analysé par le juge LLM.
-- La contrainte UNIQUE fait le cache : un tour n'est jamais réanalysé, donc
-- relancer le refresh ne coûte rien sur l'historique déjà traité.
CREATE TABLE IF NOT EXISTS rag_question_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,                              -- 'web' | 'slack'
  source_id TEXT NOT NULL,                           -- chat_jobs.id | slack_chat_threads.id
  turn_index INT NOT NULL DEFAULT 0,                 -- 0 pour le web, index du tour pour Slack
  user_id TEXT,
  asked_at TIMESTAMPTZ NOT NULL,
  question TEXT NOT NULL,
  answer_excerpt TEXT,
  answer_summary TEXT,                               -- résumé 1-2 lignes de la réponse (juge)
  issue TEXT,                                        -- ce qui ne va pas (vide si verdict = answered)
  category TEXT,
  is_knowledge BOOLEAN NOT NULL DEFAULT false,       -- question de connaissance (Notion) vs sales (CRM)
  used_notion BOOLEAN NOT NULL DEFAULT false,
  notion_pages JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{title, url}] pages lues pendant le tour
  guides_loaded JSONB NOT NULL DEFAULT '[]'::jsonb,  -- packs chargés via load_guide
  verdict TEXT,                                      -- answered | partial | missing_info | wrong | off_scope
  satisfaction SMALLINT,                             -- 0-100
  satisfaction_basis TEXT,                           -- explicit (👍/👎) | inferred (juge)
  gap_summary TEXT,                                  -- ce qui manquait côté Notion
  reasoning TEXT,
  model TEXT,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id, turn_index)
);

CREATE INDEX IF NOT EXISTS rag_qa_asked_idx ON rag_question_analyses (asked_at DESC);
CREATE INDEX IF NOT EXISTS rag_qa_verdict_idx ON rag_question_analyses (verdict);
CREATE INDEX IF NOT EXISTS rag_qa_category_idx ON rag_question_analyses (category);

-- 3) Rapport de synthèse (trous dans la raquette + idées de pages) sur une fenêtre.
-- payload = { gaps[], new_pages[], quick_wins[], stats }, cf. lib/rag-insights/types.ts
CREATE TABLE IF NOT EXISTS rag_gap_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  slack_sent_at TIMESTAMPTZ,
  slack_recipients TEXT
);

CREATE INDEX IF NOT EXISTS rag_gap_reports_created_idx ON rag_gap_reports (created_at DESC);

-- 4) Meta singleton : état du dernier run (même idiome que ae_activity_meta).
-- Permet à l'UI d'afficher "analyse en cours…" et la date du dernier passage.
CREATE TABLE IF NOT EXISTS rag_insights_meta (
  id INT PRIMARY KEY DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'idle',   -- idle | running | done | error
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  analyzed_count INT,
  CONSTRAINT rag_insights_meta_singleton CHECK (id = 1)
);

INSERT INTO rag_insights_meta (id, status) VALUES (1, 'idle') ON CONFLICT (id) DO NOTHING;

-- Jobs du chat web (CoachelloGPT). Sort l'agentic loop du chemin sync Netlify
-- (~26s) vers une Background Function (jusqu'à 15 min). Le navigateur crée une
-- job via POST /api/chat, puis poll GET /api/chat/[jobId] toutes les ~1s pour
-- afficher la progression (texte streamé, étapes outils, coût) jusqu'à done/error.
-- Même worker (lib/chat/run-job.ts -> runChat) que la version Slack.
CREATE TABLE IF NOT EXISTS chat_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',   -- running | done | error
  input_messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  better_thinking BOOLEAN NOT NULL DEFAULT false,
  streaming_text TEXT NOT NULL DEFAULT '',
  tool_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  cost NUMERIC,
  history JSONB,
  final_text TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_jobs_user_id_idx ON chat_jobs (user_id);
CREATE INDEX IF NOT EXISTS chat_jobs_created_at_idx ON chat_jobs (created_at DESC);

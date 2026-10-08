-- Agents (/agents) : agents récurrents créés par n'importe quel user. Chaque
-- agent est un prompt + un sous-ensemble d'outils de CoachelloAI + un planning +
-- une destination Slack. Le dispatcher (netlify/functions/agents-dispatch-scheduled)
-- lance ceux dont next_run_at est passé ; chaque exécution est tracée dans
-- agent_runs. Code : lib/agents/.

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'New agent',
  emoji TEXT NOT NULL DEFAULT '🤖',
  color TEXT NOT NULL DEFAULT 'pink',            -- clé de palette (lib/agents/types.ts AGENT_COLORS)
  tagline TEXT,                                   -- une phrase, affichée sur la carte
  request TEXT NOT NULL,                          -- la demande d'origine, en langage naturel
  must_include TEXT,                              -- "ce que le message doit contenir" (optionnel)
  instructions TEXT NOT NULL DEFAULT '',          -- consignes d'exécution (rédigées par le designer IA, éditables)
  template TEXT NOT NULL DEFAULT '',              -- squelette markdown du message, avec {{placeholders}}
  sources TEXT[] NOT NULL DEFAULT '{}',           -- clés de lib/agents/sources.ts
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fr')),
  schedule JSONB NOT NULL,                        -- AgentSchedule (lib/agents/schedule.ts)
  destination JSONB NOT NULL DEFAULT '{"type":"dm"}', -- AgentDestination
  skip_when_empty BOOLEAN NOT NULL DEFAULT FALSE, -- rien à signaler = aucun message
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  design_status TEXT NOT NULL DEFAULT 'idle' CHECK (design_status IN ('idle', 'designing', 'error')),
  design_error TEXT,
  design_notes JSONB,                             -- { assumptions: string[], source_reasons: {source, reason}[] }
  next_run_at TIMESTAMPTZ,                        -- NULL tant que l'agent n'est pas actif
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  last_delivered_at TIMESTAMPTZ,                  -- dernier message réellement posté : borne "depuis la dernière fois"
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agents_owner_idx ON agents (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agents_due_idx ON agents (next_run_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'manual', 'preview')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'skipped', 'error')),
  deliver BOOLEAN NOT NULL DEFAULT TRUE,          -- false = aperçu, rien n'est posté
  output TEXT,                                    -- message final (markdown, avant conversion mrkdwn)
  error TEXT,
  tool_steps JSONB NOT NULL DEFAULT '[]',         -- [{ name, label }]
  sources JSONB NOT NULL DEFAULT '[]',            -- ChatSource[]
  slack_channel TEXT,
  slack_ts TEXT,
  slack_permalink TEXT,
  delivered_at TIMESTAMPTZ,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd NUMERIC(10, 4),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- heartbeat pendant l'exécution
);

CREATE INDEX IF NOT EXISTS agent_runs_agent_idx ON agent_runs (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_open_idx ON agent_runs (status, updated_at) WHERE status IN ('queued', 'running');

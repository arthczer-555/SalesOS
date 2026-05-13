-- Historique append-only des runs d'agents Market Intel.
-- intel_agent_runs ne garde que le dernier run (UPSERT par user+agent), ce qui
-- masque les échecs récurrents et n'enregistre rien pour les runs cron (qui
-- appellent les endpoints sans passer par /api/intel/agents/[id]/run).
-- Cette table reçoit une ligne par exécution, manuelle ou cron, pour pouvoir
-- afficher un journal complet et détecter les patterns d'échec.

CREATE TABLE IF NOT EXISTS intel_agent_run_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL,
  triggered_by text NOT NULL,                       -- 'manual' | 'cron'
  user_id uuid REFERENCES users(id),                -- null pour cron
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp,
  duration_ms int,
  status text NOT NULL,                             -- 'ok' | 'error' | 'partial'
  signals_count int DEFAULT 0,
  error text,
  payload jsonb                                     -- réponse brute (debug)
);

CREATE INDEX IF NOT EXISTS idx_agent_run_logs_recent
  ON intel_agent_run_logs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_run_logs_agent
  ON intel_agent_run_logs (agent_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_run_logs_errors
  ON intel_agent_run_logs (started_at DESC)
  WHERE status = 'error';

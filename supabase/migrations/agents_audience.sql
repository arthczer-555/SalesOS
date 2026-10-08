-- Agents à audience libre ("Send to a group", admins) : à chaque échéance,
-- l'audience (groupes Everyone / Sales / AE / AM / CSM / Admins + personnes
-- ajoutées ou exclues) est résolue depuis `users`. Personnalisé : un run par
-- destinataire, exécuté pour lui. Identique : un run, le même message en DM à
-- chacun. Un "lot" regroupe l'envoi pour le récap au créateur.
-- Code : lib/agents/audience.ts, lib/agents/fanout.ts.

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS recap_line TEXT;        -- résumé d'une ligne pour le récap (marqueur [[RECAP: ...]])
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS deliveries JSONB;       -- envoi identique : [{ user_id, ok, error, permalink }]
CREATE INDEX IF NOT EXISTS agent_runs_batch_idx ON agent_runs (batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'manual')),
  personalized BOOLEAN NOT NULL DEFAULT TRUE,
  recipients INTEGER NOT NULL DEFAULT 0,
  recap_sent_at TIMESTAMPTZ,                -- posé une seule fois (UPDATE conditionnel)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_batches_pending_idx ON agent_batches (created_at) WHERE recap_sent_at IS NULL;

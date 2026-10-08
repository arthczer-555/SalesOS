-- Agents partagés (onglet Team) : un collègue peut lancer l'agent d'un autre
-- POUR LUI ("Run for me") ou s'y abonner ("Subscribe") pour le recevoir à
-- chaque échéance. L'agent s'exécute alors avec SON identité ("mes deals" = ses
-- deals, sa boîte Gmail) et livre dans SON DM. Code : lib/agents/subscriptions.ts.

-- Pour qui le run s'exécute. NULL = l'owner de l'agent (comportement d'origine).
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS run_as_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS agent_runs_run_as_idx ON agent_runs (agent_id, run_as_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  last_delivered_at TIMESTAMPTZ,            -- borne "depuis la dernière fois" de CE destinataire
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, user_id)
);

CREATE INDEX IF NOT EXISTS agent_subscriptions_user_idx ON agent_subscriptions (user_id) WHERE active;
CREATE INDEX IF NOT EXISTS agent_subscriptions_agent_idx ON agent_subscriptions (agent_id) WHERE active;

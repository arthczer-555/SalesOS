-- Partage des agents avec l'équipe (onglet Team) : opt-in. Par défaut un
-- agent est PERSONNEL : invisible des collègues, ni lançable ni abonnable par
-- eux. Son owner l'active avec l'interrupteur "Share with the team" (builder
-- ou éditeur). Les agents existants deviennent personnels : les repasser en
-- partagé à la main si besoin. Code : lib/agents/access.ts.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS agents_shared_idx ON agents (updated_at DESC) WHERE shared AND status <> 'draft';

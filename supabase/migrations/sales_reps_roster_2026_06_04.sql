-- Promotion de sales_reps en "roster" éditable : la table devient la liste
-- configurable des sales affichés dans le board d'attribution (Gestion des
-- companies), avec un mapping optionnel vers un owner HubSpot. Additif only,
-- non destructif : `owner` (texte libre) reste la source de vérité de
-- l'attribution, sales_reps n'est qu'un roster/lookup.
ALTER TABLE sales_reps
  ADD COLUMN IF NOT EXISTS hubspot_owner_id TEXT,
  ADD COLUMN IF NOT EXISTS in_roster BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- in_roster = false permet de retirer un sales du bandeau sans toucher aux
-- companies (retrait non destructif). Index pour filtrer le roster visible.
CREATE INDEX IF NOT EXISTS sales_reps_in_roster_idx ON sales_reps (in_roster);

-- Onboarding auto d'un sales : marque (une seule fois) que ses mappings Slack +
-- HubSpot owner ont été résolus depuis son email à la 1ère connexion. Sert de
-- garde d'idempotence pour ne pas rappeler les API Slack/HubSpot à chaque requête.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mappings_resolved_at TIMESTAMPTZ;

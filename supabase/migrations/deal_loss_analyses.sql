-- Analyse de perte des deals closed lost (fiche /deals, bouton "Analyze the
-- loss"). Une ligne par deal HubSpot, la dernière analyse gagne. Jamais lancée
-- automatiquement : uniquement au clic, le travail tourne dans la Background
-- Function deals-loss-analyze-background (Slack + Claude dépassent les ~26 s
-- d'une route synchrone). L'UI poll cette ligne jusqu'à status = 'done'.
--
-- Table séparée de deal_analyses : un deal analysé quand il était ouvert puis
-- perdu écraserait sinon sa propre analyse.
--
-- hubspot_reason_written_at / reopen_task_* : traces des deux écritures HubSpot
-- faites au clic depuis la fiche (raison de perte corrigée, tâche de relance).

CREATE TABLE IF NOT EXISTS deal_loss_analyses (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                    TEXT UNIQUE NOT NULL,
  user_id                    UUID REFERENCES users(id) ON DELETE SET NULL,
  status                     TEXT NOT NULL DEFAULT 'pending',
  analysis                   JSONB,
  model                      TEXT,
  error_message              TEXT,
  hubspot_reason_written_at  TIMESTAMPTZ,
  reopen_task_id             TEXT,
  reopen_task_created_at     TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_loss_analyses_status ON deal_loss_analyses (status);

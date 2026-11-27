-- Lead validé = contact + tâche d'appel (décision du 2026-11-27).
-- À appliquer AVANT le déploiement du lot 0. Idempotente.
--
-- La validation d'un lead ne crée plus de carte HubSpot : elle crée le contact,
-- la société si besoin, et une tâche CALL assignée au commercial. La carte naît
-- plus tard, quand le meeting est annoncé dans #1y-new-meetings.

-- Tâche d'appel créée à la validation (marqueur "lead validé" quand il n'y a pas de carte).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS hubspot_task_id TEXT;
-- Commercial choisi à la validation (attribution du lead tant qu'aucune carte n'existe).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_hubspot_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_user_id UUID;
-- Direct ou RFP, choisi à la validation : préremplit la carte créée plus tard.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sale_type TEXT;

-- Retrouver le lead d'un contact (carte créée depuis #1y-new-meetings, rattrapage).
CREATE INDEX IF NOT EXISTS idx_leads_hubspot_contact_id ON leads (hubspot_contact_id) WHERE hubspot_contact_id IS NOT NULL;

-- Canaux Slack dédiés à un client (cf. lib/clients/slack-context.ts).
-- ────────────────────────────────────────────────────────────────────────
-- Un canal n'est relié à une fiche que si l'app CoachelloHQ (le bot Slack) en
-- est membre. Le refresh cherche les canaux dont le nom ressemble à la société
-- et relie automatiquement ceux où l'app est présente ; on peut aussi en relier
-- un à la main depuis la fiche. Les canaux reliés sont lus en entier (threads
-- compris) à chaque refresh.
--
-- slack_channels : [{ id, name, source, linked_at, linked_by }]. source = "auto"
--   (trouvé par le refresh) ou "manual" (relié depuis la fiche).
--
-- declined_slack_channel_ids : canaux retirés à la main ("Unlink"). Jamais
--   re-reliés automatiquement pour ce client.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS slack_channels             JSONB,
  ADD COLUMN IF NOT EXISTS declined_slack_channel_ids TEXT[];

-- Mémoire conversationnelle de CoachelloGPT dans Slack
-- ────────────────────────────────────────────────────────────────────────
-- Une row = une conversation Slack (DM ou thread sur mention).
-- Clé d'unicité : (channel_id, thread_ts). Pour les DMs sans thread, on
-- traite tout le canal IM comme une seule conversation (thread_ts = "").
--
-- messages stocke l'historique Anthropic.MessageParam[] complet (avec tool
-- calls / tool results) pour pouvoir reprendre la conversation au prochain
-- message dans le même thread.

CREATE TABLE IF NOT EXISTS slack_chat_threads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_team_id     TEXT,
  slack_channel_id  TEXT NOT NULL,
  slack_thread_ts   TEXT NOT NULL DEFAULT '',
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  messages          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_slack_thread
  ON slack_chat_threads (slack_channel_id, slack_thread_ts);

CREATE INDEX IF NOT EXISTS idx_slack_threads_user
  ON slack_chat_threads (user_id);

CREATE INDEX IF NOT EXISTS idx_slack_threads_updated
  ON slack_chat_threads (updated_at DESC);

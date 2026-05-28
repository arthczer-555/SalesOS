-- Cache du Slack user_id (stable) appris au 1er match nom/email, pour que le
-- chatbot reconnaisse l'utilisateur sans rappeler users.info à chaque message.
-- Cet appel Slack live échouait par intermittence (rate-limit/timeout) et
-- provoquait de faux "je ne te reconnais pas" alors que le compte est valide.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS slack_user_id TEXT;

CREATE INDEX IF NOT EXISTS users_slack_user_id_idx
  ON users (slack_user_id);

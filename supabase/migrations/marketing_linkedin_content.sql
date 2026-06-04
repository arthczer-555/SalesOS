-- Marketing LinkedIn Posts Factory: persistent analysis, recommendations, drafts
-- Mirrors marketing_content.sql (article factory) but for LinkedIn posts.
-- ────────────────────────────────────────────────────────────────────────

-- Most recent LinkedIn analysis per user (overwritten on each "Run Analysis")
CREATE TABLE IF NOT EXISTS marketing_linkedin_analysis (
  user_id      TEXT PRIMARY KEY,
  analysis     JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LinkedIn post recommendations (one row per recommendation)
CREATE TABLE IF NOT EXISTS marketing_linkedin_recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  topic             TEXT NOT NULL,
  angle             TEXT,
  target_audience   TEXT,
  justification     TEXT,
  priority          TEXT DEFAULT 'medium',
  status            TEXT NOT NULL DEFAULT 'recommended',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_li_recs_user ON marketing_linkedin_recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_marketing_li_recs_status ON marketing_linkedin_recommendations(user_id, status);

-- Generated drafts: 2 distinct posts, each with FR + EN body, hook and hashtags.
CREATE TABLE IF NOT EXISTS marketing_linkedin_drafts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL,
  recommendation_id  UUID REFERENCES marketing_linkedin_recommendations(id) ON DELETE SET NULL,
  topic              TEXT NOT NULL,
  posts              JSONB NOT NULL,            -- [{ angle, hook, body: { fr, en }, hashtags: [...] }, {...}]
  inspiration        JSONB DEFAULT '[]'::jsonb, -- real LinkedIn posts used as reference [{ title, url, snippet }]
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_li_drafts_user ON marketing_linkedin_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_marketing_li_drafts_rec ON marketing_linkedin_drafts(recommendation_id);

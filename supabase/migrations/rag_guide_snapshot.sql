-- Snapshot de secours du "cerveau" de CoachelloAI (repo GitHub Coachello.RAG :
-- coachellohq/socle.md, coachellohq/packs/*.md, AGENT_GUIDE.md). Upserté à chaque fetch
-- GitHub réussi par lib/chat/rag/guide-loader.ts, servi si GitHub est
-- indisponible (avec note d'ancienneté). Le repo reste la source de vérité.
CREATE TABLE IF NOT EXISTS rag_guide_snapshot (
  path TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

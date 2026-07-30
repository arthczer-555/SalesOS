-- Boîte à idées : ce que l'équipe voudrait voir dans SalesOS.
--
-- Volontairement minimal — un auteur, un texte, une date. Pas de statut ni de
-- vote : le tri se fait à la lecture dans /admin/ideas, et une colonne de statut
-- qu'on n'entretient pas ment plus qu'elle n'informe.
--
-- `ON DELETE CASCADE` : un compte supprimé emporte ses idées. Une idée orpheline
-- ne serait plus rattachable à personne pour la creuser.

CREATE TABLE IF NOT EXISTS ideas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ideas_created_at ON ideas(created_at DESC);

COMMENT ON TABLE ideas IS
  'Boîte à idées du dashboard (/dashboard) — lue par les admins dans /admin/ideas.';

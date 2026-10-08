-- Tier du compte : importance fixée à la main par l'équipe (1 = stratégique,
-- 2 = important, 3 = standard, null = pas encore classé). Colonne dédiée et pas
-- un champ de fields_json, pour que l'enrichissement IA ne l'écrase jamais.
-- Affiché et modifiable dans les deux vues de /clients et sur la fiche, lu par
-- les agents et CoachelloAI (search_clients / get_client) pour prioriser. On
-- garde qui et quand.

alter table clients
  add column if not exists tier smallint check (tier in (1, 2, 3)),
  add column if not exists tier_set_by text,
  add column if not exists tier_set_at timestamptz;

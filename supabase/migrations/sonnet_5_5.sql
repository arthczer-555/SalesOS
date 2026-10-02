-- Migration Sonnet 4.6 -> Sonnet 5.5 des préférences de modèle déjà stockées.
--
-- Les défauts du code pointent sur claude-sonnet-5-5, mais une préférence
-- enregistrée via /admin > Modèles IA (guide_defaults.model_preferences) ou
-- /settings (users.model_preferences) prime sur ces défauts : sans cette
-- migration, les features configurées sur Sonnet 4.6 y resteraient.
--
-- Les colonnes d'historique (agent runs, rag_insights, watchlist briefs,
-- usage logs) gardent claude-sonnet-4-6 : elles décrivent ce qui a tourné.
-- Idempotent.

UPDATE guide_defaults
SET content = replace(content, 'claude-sonnet-4-6', 'claude-sonnet-5-5')
WHERE key = 'model_preferences'
  AND content LIKE '%claude-sonnet-4-6%';

-- Fonctionne que la colonne soit jsonb ou text (cast d'affectation vers text).
UPDATE users
SET model_preferences = replace(model_preferences::text, 'claude-sonnet-4-6', 'claude-sonnet-5-5')::jsonb
WHERE model_preferences::text LIKE '%claude-sonnet-4-6%';

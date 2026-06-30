-- Dédup PAR CONTENU, en plus de la dédup par URL (dedupe_key).
--
-- Problème : `dedupe_key` = société + URL canonique. La MÊME info publiée sur 2
-- URLs différentes (2 médias, presse + repost) donne 2 clés distinctes : les deux
-- passent le ON CONFLICT, et dismisser l'une laisse l'autre revenir en boucle.
--
-- Fix : `content_key` = empreinte stable du fait (entités personne + action +
-- société) émise par Claude (dedupe_signature), indépendante de l'URL et de la
-- formulation. Le sweep (lib/signals/run-sweep.ts) bloque l'insertion d'un signal
-- dont l'URL OU le contenu existe déjà, tous statuts confondus (new/dismissed/...).
--
-- NULLABLE et NON unique : les lignes antérieures n'en ont pas, et plusieurs rows
-- (statuts différents) peuvent partager un content_key. Le blocage se fait côté
-- applicatif, pas par contrainte SQL.

ALTER TABLE prospect_signals
  ADD COLUMN IF NOT EXISTS content_key TEXT;

-- Lookup du sweep : "ce contenu a-t-il déjà été vu ?" (WHERE content_key IN (...)).
CREATE INDEX IF NOT EXISTS prospect_signals_content_key_idx
  ON prospect_signals (content_key)
  WHERE content_key IS NOT NULL;

-- One-off : replie les doublons 'new' déjà empilés AVANT ce fix, càd la même info
-- arrivée par 2 URLs (donc 2 dedupe_key). Heuristique sans content_key (les lignes
-- historiques n'en ont pas) : même société + même type + même mois d'évènement =
-- même fait. On garde la mieux scorée (à égalité, la plus ancienne) et on expire le
-- reste. Idempotent, re-jouable. Le runtime (filet flou) prend le relais ensuite.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lower(company_name), signal_type, date_trunc('month', signal_date)
           ORDER BY score DESC, created_at ASC
         ) AS rn
  FROM prospect_signals
  WHERE status = 'new'
    AND signal_date IS NOT NULL
)
UPDATE prospect_signals p
SET status = 'expired', updated_at = NOW()
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

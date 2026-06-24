-- One-off : replie les doublons 'new' créés par l'ancienne dedupe_key basée sur
-- le TITRE. Le titre est réécrit par Claude à chaque run (non déterministe), donc
-- le même article (même url) était réinséré chaque jour avec une clé différente,
-- jamais dédupé, et son created_at frais l'empêchait d'expirer => même signal en
-- boucle dans le feed. Le fix (dedupe sur l'URL canonique) empêche les futurs
-- doublons ; cette requête nettoie ceux déjà accumulés.
--
-- Signature d'un doublon : même (company_name, url), dedupe_key différente.
-- On garde la ligne la mieux scorée (à score égal, la plus ancienne pour une date
-- de feed sensée) et on passe les autres en 'expired'. Idempotent, re-jouable.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lower(company_name), url
           ORDER BY score DESC, created_at ASC
         ) AS rn
  FROM prospect_signals
  WHERE status = 'new'
    AND url IS NOT NULL
)
UPDATE prospect_signals p
SET status = 'expired', updated_at = NOW()
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

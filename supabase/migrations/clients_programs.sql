-- Programmes d'un client (Knowledge > Program scope, cf. lib/clients/programs.ts).
-- ────────────────────────────────────────────────────────────────────────
-- Le churn et le pilotage se suivent au niveau du programme, pas du compte :
-- un compte a 1 à N programmes ("Manager", "Executive coaching"...), chacun
-- avec son statut (kanban Not started / Set up / POC / Live / Turned off),
-- son type (Human / AI Role-Play / Hybrid), sa tripartite, son objectif...
-- Remplace l'ancien bloc unique fields_json.program_scope, conservé tel quel
-- (indice de la première détection, repli tant que programs est null).
--
-- programs : [{ id, name, name_source, aliases, created_by, created_at,
--   fields: { status, coaching_type, tripartite, objective, ... } }], chaque
--   attribut au format ClientFieldValue (value, confidence, source,
--   updated_at, evidence_at). null = jamais détectés : le refresh suivant
--   lance la détection même sans activité nouvelle.
--
-- declined_program_names : noms et alias des programmes supprimés à la main
--   ("Not a program"). La détection ne les recrée pas.
--
-- programs_detected_at : dernière détection IA.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS programs               JSONB,
  ADD COLUMN IF NOT EXISTS declined_program_names TEXT[],
  ADD COLUMN IF NOT EXISTS programs_detected_at   TIMESTAMPTZ;

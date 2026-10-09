-- Lien manuel fiche client -> ligne(s) du sheet revenue (cf. lib/clients/billing-link.ts).
-- ────────────────────────────────────────────────────────────────────────
-- Le billing est matché par nom de société (lib/billing/google-sheet.ts). Quand
-- le nom HubSpot ne ressemble pas à celui de l'onglet Historique ("Groupe
-- Engie" vs "ENGIE SA"), la fiche affiche "Not in revenue sheet". L'AM/CS
-- choisit alors la ou les lignes à la main depuis la carte Billing.
--
-- billing_sheet_rows : valeurs exactes de la colonne Company des lignes
--   choisies. Non vide = remplace le match par nom (enrichissement, refresh,
--   Reload, cron hebdo). Plusieurs lignes = un seul compte, montants additionnés.
--   NULL = match automatique par nom.
-- billing_linked_by / billing_linked_at : qui a fait le lien et quand.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS billing_sheet_rows TEXT[],
  ADD COLUMN IF NOT EXISTS billing_linked_by  TEXT,
  ADD COLUMN IF NOT EXISTS billing_linked_at  TIMESTAMPTZ;

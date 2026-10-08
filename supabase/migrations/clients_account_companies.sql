-- Companies HubSpot rattachées au compte d'un client, en plus de la company de
-- son deal (cf. lib/clients/account-discovery.ts).
-- ────────────────────────────────────────────────────────────────────────
-- Un même client est souvent éclaté sur plusieurs companies HubSpot : doublon
-- sans nom créé par le domaine email des contacts (Messika / messikagroup.com),
-- plusieurs companies sur le même domaine (ENGIE, ENGIE Impact), filiales
-- (VINCI Construction, Marrel pour Fassi). Le refresh les détecte, les ajoute
-- au compte (leur activité et leurs deals comptent) et les affiche dans un
-- panneau de confirmation sur la fiche.
--
-- account_companies : [{ id, name, domain, reason, detail, status, added_at,
--   confirmed_at, last_activity_at }]. status = "pending" (ajoutée par le
--   refresh, à confirmer) ou "confirmed" (gardée par un humain). Les deux
--   comptent dans les données.
--
-- declined_company_ids : companies retirées à la main ("Remove"). Exclues
--   définitivement de la détection pour ce client.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS account_companies    JSONB,
  ADD COLUMN IF NOT EXISTS declined_company_ids TEXT[];

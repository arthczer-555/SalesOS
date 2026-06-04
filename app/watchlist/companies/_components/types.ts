// Types partagés entre la page Gestion des companies et ses composants board.
export type ScopeCompany = {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
};

// Company HubSpot renvoyée par la recherche (dryRun de l'import). Sert à
// l'onglet Liste (attribution depuis HubSpot).
export type HubspotPreviewCompany = {
  hubspotId: string;
  name: string;
  industry: string | null;
  country: string | null;
  employees: number | null;
  domain: string | null;
  lifecyclestage: string | null;
  ownerId: string | null;
  createdAt: string | null;
  alreadyInScope: boolean;
};

// MIME custom du payload de drag (liste d'ids de companies).
export const DND_MIME = "application/x-salesos-companies";

// Clé spéciale pour la zone "Non attribué" (owner null).
export const UNASSIGNED_KEY = "__unassigned__";

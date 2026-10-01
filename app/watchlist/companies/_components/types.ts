// Types partagés entre la page Gestion des companies et ses composants board.
export type ScopeCompany = {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
  // Statut resolu (override manuel sinon auto: "To enrich" / "Contacted").
  status: string;
  // Nombre d'emails (envois distincts) envoyes a cette company via la plateforme.
  email_count: number;
};

// Statuts disponibles + styles de pastille (board + override).
export const STATUS_STYLE: Record<string, { fg: string; bg: string; dot: string }> = {
  "To enrich": { fg: "#9a6a00", bg: "#fdf3d6", dot: "#e0a316" },
  Enriched: { fg: "#6b3fb5", bg: "#efe9fb", dot: "#8b5cf6" },
  Contacted: { fg: "#1f6f4a", bg: "#e3f4ea", dot: "#22a06b" },
  "In progress": { fg: "#2a4fb5", bg: "#e7edfb", dot: "#3d6fd6" },
  Won: { fg: "#136c4a", bg: "#d9f3e4", dot: "#16a34a" },
  Lost: { fg: "#8a8a90", bg: "#f0f0ef", dot: "#aeaeb4" },
};

export const STATUS_OPTIONS = ["To enrich", "Enriched", "Contacted", "In progress", "Won", "Lost"] as const;

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
export const DND_MIME = "application/x-coachellohq-companies";

// Clé spéciale pour la zone "Non attribué" (owner null).
export const UNASSIGNED_KEY = "__unassigned__";

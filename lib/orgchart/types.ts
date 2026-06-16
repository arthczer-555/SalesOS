// Types partagés de la feature Org Chart / Account Mapping.
// La base Supabase (orgchart_accounts / orgchart_people) est la source de
// vérité ; la hiérarchie est une adjacency list via `manager_id`.

export const LEVELS = ["c_level", "vp", "director", "manager", "ic", "unknown"] as const;
export type Level = (typeof LEVELS)[number];

// Rang de séniorité (plus grand = plus haut). Sert à ordonner le layout et à
// valider qu'un manager est strictement au-dessus de son subordonné.
export const LEVEL_RANK: Record<Level, number> = {
  c_level: 5,
  vp: 4,
  director: 3,
  manager: 2,
  ic: 1,
  unknown: 0,
};

// Départements canoniques (set "lean") pour les sous-zones du whiteboard.
// People / Talent / HRBP / Rewards sont repliés dans `hr`. Tout ce qui ne
// matche aucun → null (placé dans la zone d'entité, hors sous-zone).
export const DEPARTMENTS = ["hr", "learning", "sales", "ai"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  hr: "HR",
  learning: "L&D",
  sales: "Sales",
  ai: "AI / Data",
};

// Couleur de la sous-zone (header + bordure) par département.
export const DEPARTMENT_COLORS: Record<Department, { fg: string; bg: string; border: string }> = {
  hr: { fg: "#9d174d", bg: "#fdf2f8", border: "#fbcfe8" },
  learning: { fg: "#6d28d9", bg: "#f5f3ff", border: "#ddd6fe" },
  sales: { fg: "#059669", bg: "#ecfdf5", border: "#a7f3d0" },
  ai: { fg: "#1e40af", bg: "#eff6ff", border: "#bfdbfe" },
};

// Normalise un département (texte libre FR/EN OU clé canonique) -> clé canonique
// ou null. Utilisé par le layout, le rendu et l'import/classification.
export function canonicalDepartment(dept: string | null | undefined): Department | null {
  const t = (dept ?? "").toLowerCase().trim();
  if (!t) return null;
  if (DEPARTMENTS.includes(t as Department)) return t as Department;
  if (/\b(l&d|l & d|learning|formation|training|enablement|développement|developpement|dev)\b/.test(t)) return "learning";
  if (/\b(sales|revenue|commercial|account exec|ae)\b/.test(t)) return "sales";
  if (/\b(ai|a\.i|ia|data|ml|machine learning|analytics|analyst)\b/.test(t)) return "ai";
  if (/\b(hr|rh|human resources|people|culture|talent|hrbp|recruit|rewards|comp|reward|drh)\b/.test(t)) return "hr";
  return null;
}

export const DECISION_ROLES = [
  "decision_maker",
  "champion",
  "influencer",
  "gatekeeper",
  "user",
  "unknown",
] as const;
export type DecisionRole = (typeof DECISION_ROLES)[number];

export const RELATIONSHIP_STATUSES = [
  "engaged",
  "cold",
  "never_contacted",
  "left",
  "unknown",
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export type PersonSource = "manual" | "csv" | "hubspot" | "apollo";

export type CustomColumnType = "text" | "number" | "date" | "select";

export interface CustomColumn {
  key: string;
  label: string;
  type: CustomColumnType;
  options?: string[]; // pour type === "select"
}

export interface OrgAccount {
  id: string;
  name: string;
  hubspot_company_id: string | null; // company "primaire" (1ère liée), cible Apollo par défaut
  domain: string | null;
  owner: string | null;
  custom_columns: CustomColumn[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Une company HubSpot rattachée à un compte (multi-company).
export interface AccountCompany {
  id: string;
  account_id: string;
  hubspot_company_id: string;
  name: string | null;
  domain: string | null;
}

// Résultat de recherche de company HubSpot (modale New account / Add company).
export interface HubspotCompanyHit {
  id: string;
  name: string;
  domain: string | null;
}

export interface OrgPerson {
  id: string;
  account_id: string;
  name: string;
  title: string | null;
  title_hubspot: string | null;
  department: string | null;
  entity: string | null;
  level: Level | null;
  decision_role: DecisionRole | null;
  relationship_status: RelationshipStatus | null;
  manager_id: string | null;
  last_interaction: string | null;
  deal: string | null;
  owner: string | null;
  linkedin_url: string | null;
  email: string | null;
  hubspot_contact_id: string | null;
  hubspot_company_id: string | null;
  in_hubspot: boolean;
  notes: string | null;
  apollo_id: string | null;
  pos_x: number | null;
  pos_y: number | null;
  level_confidence: number | null;
  manager_confidence: number | null;
  custom_fields: Record<string, unknown>;
  source: PersonSource;
  created_at: string;
  updated_at: string;
}

// Champs librement éditables d'une personne (tout sauf id/account_id/timestamps).
export type OrgPersonInput = Partial<
  Omit<OrgPerson, "id" | "account_id" | "created_at" | "updated_at">
>;

export interface OrgEdge {
  id: string; // `${manager_id}->${person_id}`
  source: string; // manager id
  target: string; // subordinate id
}

export interface OrgCluster {
  key: string; // entity normalisée (clé stable)
  label: string; // entity affichée
  personIds: string[];
}

export interface AccountChart {
  account: OrgAccount;
  companies: AccountCompany[];
  people: OrgPerson[];
  edges: OrgEdge[];
  clusters: OrgCluster[];
}

// Résultat agrégé d'un import (HubSpot ou CSV).
export interface ImportResult {
  total: number;
  created: number;
  classified: number;
  managers_linked: number;
  errors: number;
}

export interface OrgImportJob {
  id: string;
  user_id: string;
  account_id: string | null;
  source: "hubspot" | "csv";
  company_name: string | null;
  hubspot_company_id: string | null;
  status: "running" | "done" | "error";
  params: unknown;
  result: ImportResult | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

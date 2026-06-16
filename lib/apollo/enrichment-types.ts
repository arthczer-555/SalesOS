// Types partagés du flux d'enrichissement Apollo -> HubSpot.

export type PersonOutcome =
  | "created" // contact créé dans HubSpot
  | "existing" // contact déjà présent (dédup par email)
  | "no_email" // email introuvable / verrouillé après reveal
  | "reveal_error" // l'appel reveal Apollo a échoué
  | "error"; // erreur HubSpot (create/associate)

// Snapshot d'une personne traitée (stocké dans apollo_enrichment_jobs.people).
export interface PersonResult {
  apollo_id: string;
  name: string;
  title: string | null;
  linkedin_url: string | null;
  email: string | null;
  email_status: string | null;
  outcome: PersonOutcome;
  hubspot_contact_id: string | null;
  reason: string | null;
}

export interface EnrichSummary {
  total: number;
  revealed: number;
  created: number;
  existing: number;
  no_email: number;
  associated: number;
  errors: number;
  credits_used: number;
}

// Entrée envoyée par le front pour chaque profil coché.
export interface EnrichPersonInput {
  apolloId: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  title: string | null;
  linkedinUrl: string | null;
  // Email déjà débloqué côté search (évite un reveal/crédit inutile).
  email: string | null;
  // Cible HubSpot par profil (mode bulk : chaque profil porte sa company de la
  // watchlist). Si absent, on retombe sur la company au niveau du job.
  hubspotCompanyId?: string | null;
  companyName?: string | null;
  domain?: string | null;
  // Org Chart : ligne orgchart_people à mettre à jour (email + hubspot id) une
  // fois l'enrichissement fait. Permet l'enrich multi-personnes d'un compte.
  orgchartPersonId?: string | null;
}

// ── Bulk discovery (apollo_bulk_jobs) ───────────────────────────────────────

// Un candidat ICP nouveau (pas encore dans HubSpot pour cette company).
export interface BulkCandidate {
  apollo_id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  title: string | null;
  seniority: string | null;
  linkedin_url: string | null;
  email: string | null; // masqué en général tant que pas révélé
}

export interface BulkCompanyResult {
  scope_company_id: string;
  hubspot_company_id: string | null; // null si introuvable dans HubSpot
  name: string;
  domain: string | null;
  status: "ok" | "no_domain" | "not_on_hubspot" | "error";
  existing_count: number; // contacts HubSpot déjà associés
  new_count: number;
  candidates: BulkCandidate[]; // uniquement les nouveaux
  reason?: string | null;
}

export interface BulkSummary {
  companies_total: number;
  companies_searched: number;
  companies_unlinked: number; // watchlist mais introuvables dans HubSpot
  candidates_total: number;
}

export interface ApolloBulkJob {
  id: string;
  user_id: string;
  status: "running" | "done" | "error";
  params: { titles?: string[]; seniorities?: string[]; location?: string | null; perCompany?: number };
  companies: BulkCompanyResult[];
  summary: BulkSummary | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApolloEnrichJob {
  id: string;
  user_id: string;
  scope_company_id: string | null;
  hubspot_company_id: string;
  hubspot_company_name: string | null;
  hubspot_company_domain: string | null;
  hubspot_owner_id: string | null;
  add_to_scope_owner: string | null;
  status: "running" | "done" | "error";
  people: PersonResult[];
  summary: EnrichSummary | null;
  error: string | null;
  credits_used: number;
  created_at: string;
  updated_at: string;
}

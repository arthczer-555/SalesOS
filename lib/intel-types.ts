// ── Listes / enrichissement HubSpot — types partagés ─────────────────────────

export type EnrichmentSource = "brightdata" | "hubspot" | "mixed";

export type ProfileSource =
  | "manual"
  | "init"
  | "hubspot"
  | "champion"
  | "competitor";

export interface EnrichmentProfile {
  username: string | null;
  fullName: string;
  firstName?: string;
  lastName?: string;
  headline?: string | null;
  company?: string | null;
  profileUrl?: string | null;
  email?: string | null;
  hubspotId?: string | null;
  selected?: boolean;
  source?: ProfileSource;
  isChampion?: boolean;
  // HubSpot extras
  jobTitle?: string | null;
  lifecyclestage?: string | null;
  leadStatus?: string | null;
  createdAt?: string | null;
  ownerName?: string | null;
  ownerId?: string | null;
  lastContactedAt?: string | null;
  numAssociatedDeals?: number;
  topDeal?: { id: string; name: string; stage: string; stageLabel?: string; amount: string | null; isClosed?: boolean; isWon?: boolean } | null;
  // Renseignés après un envoi (optionnel) de la liste vers HubSpot.
  pushedToHubspotAt?: string | null;
  pushOutcome?: ProfilePushOutcome;
}

// Résultat de l'envoi d'un contact vers HubSpot (action optionnelle "Pousser
// dans HubSpot" sur une liste). `company` reflète l'association à une company
// EXISTANTE uniquement (on ne crée jamais de company, cf. choix produit).
export interface ProfilePushOutcome {
  status: "created" | "existing" | "skipped" | "error";
  // "created" = la company n'existait pas dans HubSpot et a été créée (option
  // createMissingCompanies de l'enrich), puis associée.
  company: "associated" | "created" | "not_found" | "none";
  reason?: string;
}

export interface HubspotPipelineStage {
  id: string;
  label: string;
  isClosed: boolean;
  isWon: boolean;
  displayOrder: number;
}

export interface HubspotOwner {
  id: string;
  name: string;
  email: string;
}

export type HubspotPreset =
  | "customers"
  | "past-won"
  | "past-lost"
  | "cold-leads"
  | "active-pipeline"
  | "never-contacted"
  | "my-customers";

export interface HubspotCriteria {
  q?: string;
  owner?: string[];
  // Ids de companies de la watchlist (scope_companies). Côté serveur, on résout
  // chaque id vers ses contacts HubSpot *associés* (mêmes contacts que la fiche
  // company), cf. resolveWatchlistCompanyContactIds.
  companies?: string[];
  lifecyclestage?: string[];
  leadStatus?: string[];
  industry?: string[];
  country?: string[];
  companysize?: string[];
  source?: string[];
  // Deal-stage based filters
  dealStages?: string[];                // stage IDs (closedwon, closedlost, ou stage IDs custom)
  dealStatus?: "closed-won" | "closed-lost" | "open" | "any";
  // Engagement filters
  hasLinkedin?: boolean;                // contact a un linkedin_url
  neverContacted?: boolean;             // notes_last_contacted IS NULL
  daysSinceLastContact?: number;        // > N jours
  // Date filter (creation)
  createdRange?: "7d" | "30d" | "90d" | "year" | "custom" | "all";
  createdFrom?: string;
  createdTo?: string;
  // Sort + pagination
  sort?: "createdate-desc" | "lastcontacted-desc" | "lastcontacted-asc" | "alpha" | "deal-amount-desc";
  limit?: number;
  // hubspotIds déjà chargés (pour "Charger plus")
  excludeIds?: string[];
  // Preset (UI seulement, mappé en filtres avant POST)
  preset?: HubspotPreset;
  // Auto-resolve LinkedIn pendant l'import
  autoResolveLinkedin?: boolean;
}

/** Résumé de la dernière campagne lancée depuis une liste (pour la carte liste). */
export interface ListLastCampaign {
  id: string;
  name: string | null;
  status: string;
  created_at: string;
  emailCount: number;
  sentCount: number;
  draftedCount: number;
}

export interface EnrichmentList {
  id: string;
  user_id: string;
  name: string;
  source: EnrichmentSource;
  criteria: HubspotCriteria | Record<string, unknown> | null;
  results: EnrichmentProfile[];
  created_at: string;
  updated_at: string;
  // Attaché côté API GET : dernière campagne (list_id = cette liste), si elle existe.
  last_campaign?: ListLastCampaign | null;
}

// État de l'envoi d'une liste vers HubSpot. Persisté dans
// enrichment_lists.criteria.hubspotPush (pas de colonne dédiée) et lu par l'UI
// pour le polling + le récap.
export interface HubspotPushSummary {
  total: number;
  created: number;
  existing: number;
  skippedNoEmail: number;
  companyAssociated: number;
  companyNotFound: number;
  // Companies créées dans HubSpot (option createMissingCompanies).
  companyCreated: number;
  // Companies ajoutées à scope_companies (watchlist) avec un owner (option
  // addToScopeOwner de l'enrich).
  scopeUpserted: number;
  errors: number;
}

// Options de l'enrich (CSV → HubSpot). Persistées dans
// criteria.hubspotPush.options et passées à pushListToHubspot.
export interface HubspotPushOptions {
  createMissingCompanies: boolean;
  addToScopeOwner: string | null;
}

export interface HubspotPushState {
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  summary?: HubspotPushSummary;
  options?: HubspotPushOptions;
  error?: string;
}

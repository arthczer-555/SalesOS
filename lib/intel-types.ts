// ── Market Intel — types partagés ────────────────────────────────────────────

export type SignalType =
  | "funding"
  | "hiring"
  | "nomination"
  | "expansion"
  | "restructuring"
  | "content"
  | "job_change"
  | "linkedin_post"
  | "competitor_engagement"
  | "job_change_icp_match"
  | "ads"
  | "champion_change";

export type AgentId =
  | "job-change"
  | "company-news"
  | "competitor-activity"
  | "hiring-spike"
  | "funding-expansion"
  | "champion-tracker"
  | "intent-content"
  | "ads-activity";

export type ActionType = "email" | "linkedin" | "call" | "monitor";

export type IntelCategory = "first-party" | "social" | "web";

export interface ScoreBreakdown {
  icp?: number;
  actionability?: number;
  freshness?: number;
  source_reliability?: number;
  signal_strength?: number;
}

export interface Intel {
  id: string;
  user_id: string;
  agent_id: AgentId | null;
  company_name: string | null;
  signal_type: SignalType;
  title: string;
  summary: string | null;
  strength: number | null;
  score: number;
  score_breakdown: ScoreBreakdown | null;
  source_url: string | null;
  source_domain: string | null;
  why_relevant: string | null;
  suggested_action: string | null;
  action_type: ActionType | null;
  company_enrichment: Record<string, unknown> | null;
  is_read: boolean;
  is_actioned: boolean;
  archived: boolean;
  created_at: string;
}

export interface IntelFilters {
  agents?: AgentId[];
  scoreMin?: number;
  period?: "24h" | "7d" | "30d" | "all";
  status?: "all" | "unread" | "actionable" | "archived";
  q?: string;
  username?: string;
}

export interface IntelStats {
  total: number;
  unread: number;
  actionable: number;
}

// ── Agents ──────────────────────────────────────────────────────────────────

export type AgentStatus = "active" | "partial" | "inactive";

export interface AgentRunMetadata {
  enabled: boolean;
  last_run_at: string | null;
  last_run_status: "ok" | "error" | "partial" | "running" | null;
  last_run_signals_count: number;
  last_run_error: string | null;
  config: Record<string, unknown> | null;
}

export interface AgentDef {
  id: AgentId;
  name: string;
  description: string;
  category: IntelCategory;
  status: AgentStatus;
  estimatedCreditsPerRun: string;
  signalTypes: SignalType[];
  runEndpoint: string | null;            // null = pas de run manuel (push only)
  iconName: string;                      // nom d'icône lucide-react
  configurable: boolean;
}

export interface Agent extends AgentDef, AgentRunMetadata {
  weeklyIntelsCount?: number;            // calculé à la demande
}

// ── Enrichissement ──────────────────────────────────────────────────────────

export type EnrichmentSource = "netrows" | "hubspot" | "mixed";

export type ProfileSource =
  | "manual"
  | "init"
  | "hubspot"
  | "netrows-search"
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
  addedToRadar?: boolean;
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

export interface NetrowsCriteria {
  companies?: string[];
  titles?: string[];
  sectors?: string[];
  sizes?: string[];
  keywords?: string;
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
  // Exclusion : profils LinkedIn déjà au Radar (par défaut true) + hubspotIds déjà chargés (pour "Charger plus")
  excludeRadar?: boolean;
  excludeIds?: string[];
  // Preset (UI seulement, mappé en filtres avant POST)
  preset?: HubspotPreset;
  // Auto-resolve LinkedIn pendant l'import
  autoResolveLinkedin?: boolean;
}

export interface EnrichmentList {
  id: string;
  user_id: string;
  name: string;
  source: EnrichmentSource;
  criteria: NetrowsCriteria | HubspotCriteria | null;
  results: EnrichmentProfile[];
  created_at: string;
  updated_at: string;
}

export interface RadarSnapshot {
  summary?: string;
  skills?: string[];
  educations?: { schoolName?: string; degree?: string; fieldOfStudy?: string }[];
  positions?: {
    companyName?: string;
    title?: string;
    location?: string;
    start?: { year?: number; month?: number };
    end?: { year?: number; month?: number };
  }[];
}

export interface RadarProfile {
  id: string;
  username: string;
  full_name: string | null;
  headline: string | null;
  company: string | null;
  profile_url: string | null;
  source: ProfileSource;
  radar_active: boolean;
  is_champion: boolean;
  last_change_at: string | null;
  last_refreshed_at: string | null;
  last_snapshot: RadarSnapshot | null;
  created_at: string;
}

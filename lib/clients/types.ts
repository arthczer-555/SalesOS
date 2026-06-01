// Types partagés pour la feature Clients.
// Le contenu des fields est stocké dans `clients.fields_json` (jsonb) sous
// la forme `{ [fieldKey]: ClientFieldValue }`. Chaque field garde sa valeur,
// la confiance de l'IA, et la source (HubSpot note/email/meeting, Claap
// recording, ou édition manuelle). L'UI peut ainsi cliquer sur un field
// pour voir d'où il vient et afficher une pastille de confiance.

export type ClientFieldSource =
  | { kind: "hubspot"; entity: "note" | "email" | "meeting" | "call" | "deal" | "company"; id?: string }
  | { kind: "claap"; recordingId?: string }
  | { kind: "manual"; userEmail?: string }
  | { kind: "inferred" };

export type ClientFieldValue<T = unknown> = {
  value: T | null;
  confidence: number; // 0..1
  source: ClientFieldSource | null;
  updated_at: string; // ISO
};

// ── 2.1 Informations générales ───────────────────────────────────────────
export type GeneralInfoFields = {
  entreprise_compte: ClientFieldValue<string>;
  contact_signataire: ClientFieldValue<{ name: string; email?: string; role?: string }>;
  contact_principal_rh: ClientFieldValue<{ name: string; email?: string; role?: string }>;
  contact_rh_operationnel: ClientFieldValue<{ name: string; email?: string; role?: string }>;
  autres_parties_prenantes: ClientFieldValue<Array<{ name: string; email?: string; role?: string }>>;
  langues_requises: ClientFieldValue<string[]>;
  zones_geographiques: ClientFieldValue<string[]>;
};

// ── 2.2 Périmètre du programme ───────────────────────────────────────────
export type TypeCoaching = "humain" | "ia" | "hybride";
export type ProgramScopeFields = {
  type_coaching: ClientFieldValue<TypeCoaching>;
  nom_programme: ClientFieldValue<string>;
  population_accompagnee: ClientFieldValue<string>;
  nb_coaches_estime: ClientFieldValue<number>;
  cohortes_format: ClientFieldValue<string>;
  auto_assessment: ClientFieldValue<{ enabled: boolean; details?: string }>;
  flash_feedback: ClientFieldValue<{ enabled: boolean; details?: string }>;
  tripartite: ClientFieldValue<{ enabled: boolean; details?: string }>;
  quadripartite: ClientFieldValue<{ enabled: boolean; details?: string }>;
  offres_associees: ClientFieldValue<string[]>;
};

// ── 2.3 Objectifs & attentes ─────────────────────────────────────────────
export type GoalsFields = {
  objectifs_business_rh: ClientFieldValue<string[]>;
  kpis_cles: ClientFieldValue<string[]>;
  attentes_specifiques: ClientFieldValue<string>;
};

// ── 2.4 Organisation & intégration ───────────────────────────────────────
export type OrgFields = {
  integration_it: ClientFieldValue<string>;
  referentiels_documents: ClientFieldValue<Array<{ title: string; url?: string }>>;
  contraintes_organisationnelles: ClientFieldValue<string>;
};

// ── 2.5 Contexte & historique ────────────────────────────────────────────
export type RelationCommerciale = "nouveau" | "renouvellement" | "upsell";
export type HistoryFields = {
  relation_commerciale: ClientFieldValue<RelationCommerciale>;
  initiatives_rh_paralleles: ClientFieldValue<string>;
  points_de_vigilance: ClientFieldValue<string[]>;
};

// ── 2.6 Planning & prochaines étapes ─────────────────────────────────────
export type PlanningFields = {
  kickoff_envisage_le: ClientFieldValue<string>; // ISO date
  suivi_cs_attendu: ClientFieldValue<string[]>;
  engagements_sales: ClientFieldValue<string[]>;
};

export type ClientFields = {
  general_info: GeneralInfoFields;
  program_scope: ProgramScopeFields;
  goals: GoalsFields;
  org: OrgFields;
  history: HistoryFields;
  planning: PlanningFields;
};

// ── Sections meta (pour l'UI : ordre, libellés, mapping) ─────────────────
// Ordre repris du plan §2 (Informations → Périmètre → Objectifs → Orga →
// Contexte → Planning). Source de vérité unique pour l'UI : la fiche
// itère sur SECTION_DEFINITIONS pour afficher chaque bloc dans l'ordre.

export type SectionKey = keyof ClientFields;

export type FieldDefinition = {
  key: string;
  label: string;
  kind: "text" | "long_text" | "array_string" | "array_contact" | "array_doc" | "number" | "date" | "enum" | "bool_with_details" | "contact";
  options?: readonly string[];
  // Libellés d'affichage par valeur d'enum. La valeur stockée reste canonique
  // (FR) — seul l'affichage est traduit, pour ne pas casser les données ni le
  // prompt d'extraction.
  optionLabels?: Record<string, string>;
};

export const SECTION_DEFINITIONS: ReadonlyArray<{
  key: SectionKey;
  label: string;
  fields: FieldDefinition[];
}> = [
  {
    key: "general_info",
    label: "General information",
    fields: [
      { key: "entreprise_compte", label: "Company / account", kind: "text" },
      { key: "contact_signataire", label: "Signatory contact", kind: "contact" },
      { key: "contact_principal_rh", label: "Primary HR contact", kind: "contact" },
      { key: "contact_rh_operationnel", label: "Operational HR contact", kind: "contact" },
      { key: "autres_parties_prenantes", label: "Other stakeholders", kind: "array_contact" },
      { key: "langues_requises", label: "Required languages", kind: "array_string" },
      { key: "zones_geographiques", label: "Geographic regions", kind: "array_string" },
    ],
  },
  {
    key: "program_scope",
    label: "Program scope",
    fields: [
      { key: "type_coaching", label: "Coaching type", kind: "enum", options: ["humain", "ia", "hybride"] as const, optionLabels: { humain: "Human", ia: "AI", hybride: "Hybrid" } },
      { key: "nom_programme", label: "Program name", kind: "text" },
      { key: "population_accompagnee", label: "Target population", kind: "text" },
      { key: "nb_coaches_estime", label: "Estimated number of coachees", kind: "number" },
      { key: "cohortes_format", label: "Cohorts / format", kind: "text" },
      { key: "auto_assessment", label: "Auto-assessment", kind: "bool_with_details" },
      { key: "flash_feedback", label: "Flash feedback", kind: "bool_with_details" },
      { key: "tripartite", label: "Tripartite", kind: "bool_with_details" },
      { key: "quadripartite", label: "Quadripartite", kind: "bool_with_details" },
      { key: "offres_associees", label: "Add-on offers", kind: "array_string" },
    ],
  },
  {
    key: "goals",
    label: "Goals & expectations",
    fields: [
      { key: "objectifs_business_rh", label: "Business / HR goals", kind: "array_string" },
      { key: "kpis_cles", label: "Key KPIs", kind: "array_string" },
      { key: "attentes_specifiques", label: "Specific expectations", kind: "long_text" },
    ],
  },
  {
    key: "org",
    label: "Organization & integration",
    fields: [
      { key: "integration_it", label: "IT integration (SSO, HRIS, Slack, …)", kind: "long_text" },
      { key: "referentiels_documents", label: "References & documents", kind: "array_doc" },
      { key: "contraintes_organisationnelles", label: "Organizational constraints", kind: "long_text" },
    ],
  },
  {
    key: "history",
    label: "Context & history",
    fields: [
      { key: "relation_commerciale", label: "Commercial relationship", kind: "enum", options: ["nouveau", "renouvellement", "upsell"] as const, optionLabels: { nouveau: "New", renouvellement: "Renewal", upsell: "Upsell" } },
      { key: "initiatives_rh_paralleles", label: "Parallel HR initiatives", kind: "long_text" },
      { key: "points_de_vigilance", label: "Watch points", kind: "array_string" },
    ],
  },
  {
    key: "planning",
    label: "Planning & next steps",
    fields: [
      { key: "kickoff_envisage_le", label: "Planned kickoff date", kind: "date" },
      { key: "suivi_cs_attendu", label: "Expected CS follow-up", kind: "array_string" },
      { key: "engagements_sales", label: "Sales commitments", kind: "array_string" },
    ],
  },
] as const;

// ── Deal recap (généré plus tard, structuré façon Coachello-GPT) ─────────
export type DealRecap = {
  generated_at: string;
  timeline?: Array<{ when?: string; title: string; description: string; source?: ClientFieldSource | null }>;
  how_closed?: string;
  objections?: string[];
  triggers?: string[];
  sales_promises?: string[];
  onboarding_risks?: string[];
};

// ── Coach brief (généré par l'enrichissement, partagé manuellement aux coachs) ─
// Structure calquée sur le message Slack qu'on envoie au canal coachs au
// staffing : intro company + contexte business + programmes + objectifs +
// langues + journey + dates. Stocké structuré, rendu en markdown côté UI
// (CoachBriefPanel) ou plus tard en Slack/email.

export type CoachBriefLanguages = {
  region: string; // ex: "EUROPE", "APAC", "LATAM", "Global"
  languages: string[];
};

export type CoachBriefProgram = {
  name: string;        // ex: "Executive Program", "Managers Program"
  description: string; // ex: "designed to accompany senior leaders on strategic topics"
  nb_sessions?: number | null;
  population?: string | null; // ex: "senior leaders", "managers"
};

export type CoachBrief = {
  intro?: string | null;
  industry?: string | null;
  website?: string | null;
  context?: string | null;
  programs?: CoachBriefProgram[];
  goal?: string | null;
  location?: string | null;
  coaching_languages?: CoachBriefLanguages[];
  coachee_journey?: string | null;
  ai_coaching?: boolean | null;
  coachello_app?: string | null;          // "Slack", "Teams", "Email"
  briefing_meeting_date?: string | null;  // ISO ou texte libre si pas encore fixé
  nb_sessions_per_coachee?: number | null;
  tripartite?: string | null;             // "Optional in first session", "Required", "None"
  onboarding_start_date?: string | null;
  program_end_date?: string | null;
  program_duration?: string | null;       // "6 months", "9 months", "6 to 9 months"
};

// ── Health / Insights / News (squelettes — remplis dans une étape ultérieure) ─
export type HealthLabel = "green" | "yellow" | "red";
export type HealthSnapshot = {
  score: number;
  label: HealthLabel;
  drivers: string[];
  computed_at: string;
};
export type Health = HealthSnapshot & {
  trend?: "up" | "down" | "stable";
  // Phrase courte (FR) expliquant le score, ancrée surtout sur les derniers
  // échanges (meetings récents). Générée par IA à l'enrichissement, best-effort
  // (null si la génération échoue ou pas de signal). Pas stockée dans les
  // snapshots d'historique, c'est une lecture du moment présent.
  summary?: string | null;
};

export type Insights = {
  generated_at: string;
  actions: Array<{ title: string; rationale?: string; priority?: "high" | "medium" | "low" }>;
  observations: string[];
};

// Catégorie attribuée par le ranking IA (Haiku) pour ne garder que les news
// intéressantes côté CS. "other" = catégorisé mais hors des buckets clés.
export type NewsCategory =
  | "funding"
  | "hiring"
  | "acquisition"
  | "leadership"
  | "product"
  | "other";

export type News = {
  refreshed_at: string;
  items: Array<{
    title: string;
    url: string;
    published_at?: string;
    summary?: string;
    relevance?: number; // score brut Tavily
    category?: NewsCategory; // attribué par rankClientNews (Haiku)
    interest?: number; // 0..1, attribué par rankClientNews, sert au tri/filtre
  }>;
};

// ── Refresh report (bouton "Actualiser" + cron) ──────────────────────────────
// "Petit point" affiché en bandeau sur la fiche après un refresh incrémental :
// combien de nouvelles activités prises en compte, évolution du health, et la
// liste des fields qui ont changé. skipped_no_activity = true quand le refresh
// a tourné mais n'a trouvé aucune activité nouvelle (health/news recalculés
// quand même, fields inchangés).
export type RefreshReport = {
  refreshed_at: string;
  health_before: number | null;
  health_after: number | null;
  new_activity_count: number;
  changed_fields: Array<{ section: SectionKey; key: string; label: string }>;
  skipped_no_activity?: boolean;
  error?: string;
};

// ── Facturation (onglet "Historique" du fichier revenue Google Drive) ─────────
// Une ligne par société : Total lifetime + revenu par année + flag RFP. Matché
// par nom de société normalisé. matched=false si aucune ligne trouvée.
export type Billing = {
  matched: boolean;
  match_key?: string; // valeur du nom de société utilisée pour le match
  total_contract_value?: number | null; // colonne "Total" (lifetime)
  revenue_by_year?: Record<string, number>; // { "2022": 38140, ..., "2026": 51391 }
  current_year_revenue?: number | null;
  prev_year_revenue?: number | null;
  yoy_growth?: number | null; // (courant - précédent) / précédent
  is_rfp?: boolean;
};

// ── Recordings Claap découverts (live API, pas encore dans sales_coach_analyses) ─
// Persistés en JSONB dans `clients.discovered_claap_recordings` au moment de
// l'enrichissement. Sert au TimelinePanel pour afficher des meetings qui
// existent côté Claap mais qui n'ont pas (encore) été passés dans le pipeline
// sales-coach. Cf. migration clients_discovered_meetings.sql.
export type DiscoveredRecording = {
  recording_id: string;
  meeting_title: string | null;
  meeting_started_at: string | null;
  claap_url: string | null;
  discovered_at: string;
};

// ── Confirmation des meetings (garde-fou avant analyse) ───────────────────
// À l'import (webhook ou backfill), on découvre les meetings Claap du compte
// et on les propose dans un popup pour qu'un humain confirme/complète avant que
// l'analyse démarre. Cf. migration clients_meeting_confirmation.sql.
//
// Candidat affiché dans le popup. `source` distingue les meetings déjà analysés
// (sales_coach_analyses) des meetings découverts en direct sur Claap.
export type MeetingCandidate = {
  recording_id: string;
  meeting_title: string | null;
  meeting_started_at: string | null;
  claap_url: string | null;
  source: "indexed" | "discovered";
};

// Recording validé par l'humain (gardé depuis les candidats ou ajouté à la
// main via recherche/URL). C'est la liste que l'enrichissement consomme.
export type ConfirmedRecording = {
  recording_id: string;
  meeting_title: string | null;
  meeting_started_at: string | null;
  claap_url: string | null;
  added_manually: boolean;
};

// ── Row Supabase ─────────────────────────────────────────────────────────
export type ClientRow = {
  id: string;
  hubspot_deal_id: string;
  hubspot_company_id: string | null;
  company_name: string;
  owner_email: string | null;
  owner_name: string | null;
  closedwon_at: string;
  deal_amount: number | null;
  fields_json: Partial<ClientFields>;
  deal_recap: DealRecap | null;
  coach_brief: CoachBrief | null;
  coach_brief_generated_at: string | null;
  health: Health | null;
  health_history: HealthSnapshot[];
  insights: Insights | null;
  news: News | null;
  discovered_claap_recordings: DiscoveredRecording[];
  // 'awaiting_meetings' : import effectué, en attente que l'humain confirme la
  // liste des meetings Claap avant que l'analyse démarre.
  enrichment_status: "pending" | "awaiting_meetings" | "running" | "done" | "error";
  enrichment_error: string | null;
  pending_meeting_candidates: MeetingCandidate[] | null;
  confirmed_claap_recordings: ConfirmedRecording[] | null;
  meetings_confirmed_at: string | null;
  meetings_confirmed_by: string | null;
  meeting_confirmation_requested_at: string | null;
  last_enriched_at: string | null;
  last_health_run_at: string | null;
  last_news_run_at: string | null;
  last_refreshed_at: string | null;
  last_refresh_report: RefreshReport | null;
  owner_notified_at: string | null;
  billing: Billing | null;
  billing_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
};

// Factory pour générer un ClientFieldValue null (utilisé quand l'IA n'a
// pas trouvé de signal pour ce field). Garde une trace de la tentative
// d'extraction au lieu d'un trou complet dans fields_json.
export function emptyField<T>(): ClientFieldValue<T> {
  return {
    value: null,
    confidence: 0,
    source: null,
    updated_at: new Date().toISOString(),
  };
}

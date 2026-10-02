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
  // Date (YYYY-MM-DD) de la source la plus récente qui appuie la valeur, donnée
  // par l'IA à l'extraction. Sert au refresh pour décider si une info récente
  // peut remplacer une édition manuelle plus ancienne (cf. run-refresh.ts).
  evidence_at?: string | null;
};

// ── 2.1 Informations générales ───────────────────────────────────────────
export type GeneralInfoFields = {
  entreprise_compte: ClientFieldValue<string>;
  contact_signataire: ClientFieldValue<{ name: string; email?: string; role?: string }>;
  contact_principal_rh: ClientFieldValue<{ name: string; email?: string; role?: string }>;
  contact_rh_operationnel: ClientFieldValue<{ name: string; email?: string; role?: string }>;
  contact_facturation: ClientFieldValue<{ name: string; email?: string; role?: string }>;
  contact_it: ClientFieldValue<{ name: string; email?: string; role?: string }>;
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

// ── 2.4 Organisation & intégration (dont IT & accès) ─────────────────────
// Les champs IT vivent dans `org` (et pas dans une section dédiée) pour ne pas
// casser l'outil chat get_client, qui mappe déjà org = intégration IT.
export type ModeAcces = "sso" | "magic_link" | "email_password";
export type Provisioning = "manuel" | "csv" | "scim" | "sirh";
export type CanalCoaching = "slack" | "teams" | "web";
export type StatutApp = "non_requis" | "a_demander" | "en_validation" | "installee";
export type MeetingProvider = "teams" | "google_meet" | "zoom" | "autre";
export type QuestionnaireSecurite = "non_requis" | "a_faire" | "en_cours" | "valide";
export type OrgFields = {
  integration_it: ClientFieldValue<string>;
  referentiels_documents: ClientFieldValue<Array<{ title: string; url?: string }>>;
  contraintes_organisationnelles: ClientFieldValue<string>;
  mode_acces: ClientFieldValue<ModeAcces>;
  sso_details: ClientFieldValue<string>;
  provisioning: ClientFieldValue<Provisioning>;
  provisioning_details: ClientFieldValue<string>;
  canal: ClientFieldValue<CanalCoaching>;
  statut_app: ClientFieldValue<StatutApp>;
  meeting_provider: ClientFieldValue<MeetingProvider>;
  questionnaire_securite: ClientFieldValue<QuestionnaireSecurite>;
  dpa: ClientFieldValue<{ enabled: boolean; details?: string }>;
  residence_donnees: ClientFieldValue<string>;
  whitelisting_email: ClientFieldValue<{ enabled: boolean; details?: string }>;
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
  // Couleur de statut par valeur d'enum (ex : app "Installed" en vert, "Pending
  // IT approval" en ambre). Sans tone, l'enum s'affiche en pastille neutre.
  optionTones?: Record<string, "ok" | "warn" | "err" | "neutral">;
  // Champ obligatoire avant que l'AE puisse notifier l'AM/CS (handover). Vide ->
  // surligné en ambre sur la fiche + envoi bloqué.
  required?: boolean;
  // Champ recommandé pour le handover (non bloquant). Vide -> indice discret +
  // popup de confirmation avant l'envoi (l'AE peut valider quand même).
  recommended?: boolean;
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
      { key: "contact_signataire", label: "Signatory contact", kind: "contact", required: true },
      { key: "contact_principal_rh", label: "Primary HR contact", kind: "contact", required: true },
      { key: "contact_rh_operationnel", label: "Operational HR contact", kind: "contact" },
      { key: "contact_facturation", label: "Billing contact", kind: "contact", required: true },
      { key: "contact_it", label: "IT contact", kind: "contact", required: true },
      { key: "autres_parties_prenantes", label: "Other stakeholders", kind: "array_contact", recommended: true },
      { key: "langues_requises", label: "Required languages", kind: "array_string", recommended: true },
      { key: "zones_geographiques", label: "Geographic regions", kind: "array_string" },
    ],
  },
  {
    key: "program_scope",
    label: "Program scope",
    fields: [
      { key: "type_coaching", label: "Coaching type", kind: "enum", options: ["humain", "ia", "hybride"] as const, optionLabels: { humain: "Human", ia: "AI", hybride: "Hybrid" }, required: true },
      { key: "nom_programme", label: "Program name", kind: "text", required: true },
      { key: "population_accompagnee", label: "Target population", kind: "text", required: true },
      { key: "nb_coaches_estime", label: "Estimated number of coachees", kind: "number", recommended: true },
      { key: "cohortes_format", label: "Cohorts / format", kind: "text", recommended: true },
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
      { key: "objectifs_business_rh", label: "Business / HR goals", kind: "array_string", recommended: true },
      { key: "kpis_cles", label: "Key KPIs", kind: "array_string", recommended: true },
      { key: "attentes_specifiques", label: "Specific expectations", kind: "long_text" },
    ],
  },
  {
    key: "org",
    label: "Organization & IT",
    fields: [
      { key: "mode_acces", label: "Access", kind: "enum", options: ["sso", "magic_link", "email_password"] as const, optionLabels: { sso: "SSO", magic_link: "Magic link", email_password: "Email + password" }, recommended: true },
      { key: "sso_details", label: "SSO provider & protocol", kind: "text" },
      { key: "provisioning", label: "User provisioning", kind: "enum", options: ["manuel", "csv", "scim", "sirh"] as const, optionLabels: { manuel: "Manual invites", csv: "CSV import", scim: "SCIM", sirh: "HRIS sync" }, recommended: true },
      { key: "provisioning_details", label: "Provisioning details", kind: "text" },
      { key: "canal", label: "Coaching channel", kind: "enum", options: ["slack", "teams", "web"] as const, optionLabels: { slack: "Slack", teams: "Teams", web: "Web only" }, recommended: true },
      { key: "statut_app", label: "Slack / Teams app", kind: "enum", options: ["non_requis", "a_demander", "en_validation", "installee"] as const, optionLabels: { non_requis: "Not needed", a_demander: "To request", en_validation: "Pending IT approval", installee: "Installed" }, optionTones: { non_requis: "neutral", a_demander: "warn", en_validation: "warn", installee: "ok" } },
      { key: "meeting_provider", label: "Meeting provider", kind: "enum", options: ["teams", "google_meet", "zoom", "autre"] as const, optionLabels: { teams: "Teams", google_meet: "Google Meet", zoom: "Zoom", autre: "Other" } },
      { key: "questionnaire_securite", label: "Security questionnaire", kind: "enum", options: ["non_requis", "a_faire", "en_cours", "valide"] as const, optionLabels: { non_requis: "Not needed", a_faire: "To do", en_cours: "In progress", valide: "Done" }, optionTones: { non_requis: "neutral", a_faire: "warn", en_cours: "warn", valide: "ok" } },
      { key: "dpa", label: "DPA signed", kind: "bool_with_details" },
      { key: "residence_donnees", label: "Data residency", kind: "text" },
      { key: "whitelisting_email", label: "Email domain whitelisted", kind: "bool_with_details" },
      { key: "integration_it", label: "Other IT notes", kind: "long_text" },
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
      { key: "kickoff_envisage_le", label: "Planned kickoff date", kind: "date", required: true },
      { key: "suivi_cs_attendu", label: "Expected CS follow-up", kind: "array_string", recommended: true },
      { key: "engagements_sales", label: "Sales commitments", kind: "array_string" },
    ],
  },
] as const;

// ── Deal recap (généré plus tard, structuré façon CoachelloAI) ─────────
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
// Les 6 signaux du score, dans l'ordre d'affichage du popup "How is this
// computed?" (cf. lib/clients/health.ts).
export type HealthSignal = "contact" | "meetings" | "activity" | "stakeholders" | "tone" | "news";
// Source d'un driver : même forme que les sources des Next actions, plus un
// lien direct (meeting Claap, article). HubSpot n'a pas d'url : l'UI renvoie
// vers le deal.
export type HealthDriverSource = InsightSource & { url?: string | null };
// Un palier de la règle d'un signal ("Within 21 days" -> +20).
export type HealthRuleTier = { when: string; points: number };
export type HealthDriver = {
  label: string;
  impact: "positive" | "negative" | "neutral";
  // Points ajoutés ou retirés au score. 0 = signal lu mais sans effet.
  // Absent sur les fiches calculées avant la v2 du score.
  points?: number;
  signal?: HealthSignal;
  // Règle du signal en paliers, et index du palier atteint : le popup les
  // affiche tous et surligne celui-ci.
  rules?: HealthRuleTier[];
  applied?: number | null;
  // Contexte de la règle ("Thresholds for a Running account").
  rule_note?: string | null;
  // Précision affichée sous la ligne (noms des contacts, raison du ton, titre de la news).
  detail?: string | null;
  // Signal non noté parce qu'une source n'a pas pu être lue (raison affichée).
  skipped?: string | null;
  source?: HealthDriverSource | null;
};
export type HealthPhase = {
  key: "onboarding" | "running" | "renewal";
  days_since_signature: number | null;
  days_to_contract_end: number | null;
};
// Ton des derniers meetings, jugé par IA (Haiku) : une phrase de justification
// et les meetings lus, pour que le driver soit vérifiable.
export type HealthTone = {
  label: "positive" | "neutral" | "negative";
  reason: string;
  meetings: Array<{ recording_id: string; title: string | null; date: string | null; url?: string | null }>;
};
export type Health = HealthSnapshot & {
  trend?: "up" | "down" | "stable";
  // Drivers qui ont bougé le score (points ≠ 0), triés par impact : chips de la
  // carte. `drivers` (texte seul) reste pour l'historique et les anciens consommateurs.
  drivers_detail?: HealthDriver[];
  // Décomposition complète (un driver par signal, points à 0 compris) : popup
  // "How is this computed?". score = clamp(baseline + somme des points, 0, 100).
  breakdown?: HealthDriver[];
  baseline?: number;
  // Phase du compte au moment du calcul : elle règle les seuils de silence.
  phase?: HealthPhase | null;
  // Sources illisibles au calcul. Une source absente ne coûte jamais de points :
  // les signaux qui en dépendent sont marqués `skipped` et la carte l'affiche.
  data_gaps?: string[];
  tone?: HealthTone | null;
  // Dernier contact connu (engagement HubSpot ou meeting Claap) : tuile "Last
  // touch" de Key dates. null si aucune activité datée.
  last_contact_at?: string | null;
  last_contact_source?: "hubspot" | "claap" | null;
  // Phrase courte expliquant le score, ancrée surtout sur les derniers
  // échanges (meetings récents). Générée par IA à l'enrichissement, best-effort
  // (null si la génération échoue ou pas de signal). Pas stockée dans les
  // snapshots d'historique, c'est une lecture du moment présent.
  summary?: string | null;
};

// Next actions (onglet Key insights) : 1 à 3 actions, chacune avec un owner,
// une échéance et la source datée qui la déclenche. `rationale` / `observations`
// et la priorité "low" ne viennent que des anciennes générations (rétrocompat).
export type InsightSourceKind = "claap" | "hubspot" | "slack" | "news" | "fiche";
export type InsightSource = { kind: InsightSourceKind; date?: string | null; label?: string | null };
export type InsightAction = {
  id?: string;
  title: string;
  why?: string;
  rationale?: string;
  owner?: "AM" | "CS" | "AE" | null;
  due?: "this_week" | "next_2_weeks" | "this_month" | null;
  priority?: "high" | "medium" | "low";
  source?: InsightSource | null;
  done_at?: string | null;
  done_by?: string | null;
};
export type InsightHighlight = { text: string; date?: string | null; source?: InsightSource | null };
export type Insights = {
  generated_at: string;
  actions: InsightAction[];
  highlights?: InsightHighlight[];
  // Version courte des points de vigilance pour Key insights (3 max, ~8 mots).
  // La liste complète reste dans fields_json.history.points_de_vigilance.
  watch_points?: string[];
  observations?: string[];
};

// Catégorie attribuée par le ranking IA (Haiku) pour ne garder que les news
// intéressantes côté CS. "other" = catégorisé mais hors des buckets clés.
export type NewsCategory =
  | "funding"
  | "hiring"
  | "acquisition"
  | "leadership"
  | "product"
  | "restructuring"
  | "results"
  | "expansion"
  | "regulation"
  | "other";

export type NewsImportance = "high" | "medium" | "low";

export type NewsItem = {
  title: string;
  url: string;
  published_at?: string;
  summary?: string;
  relevance?: number; // score brut Tavily
  category?: NewsCategory; // attribué par rankClientNews (Haiku)
  interest?: number; // 0..1, ancien ranking (rétrocompat)
  importance?: NewsImportance; // pour un AM/CS qui gère le compte
  why_it_matters?: string | null; // une phrase : risque ou opportunité pour le compte
  source_name?: string | null; // média (Les Echos, LSA…)
  origin?: "tavily" | "google_news";
  first_seen_at?: string; // 1re fois qu'un refresh l'a vue : badge "New"
};

export type News = {
  refreshed_at: string;
  items: NewsItem[];
  // Sources qui ont échoué au dernier passage (affiché, jamais un 0 muet).
  errors?: string[];
  // Articles écartés comme bruit au dernier passage (info "N ignored").
  ignored_count?: number;
};

// ── Refresh report (bouton "Actualiser" + cron) ──────────────────────────────
// "Petit point" affiché en bandeau sur la fiche après un refresh incrémental :
// combien de nouvelles activités prises en compte, évolution du health, et la
// liste des fields qui ont changé. skipped_no_activity = true quand le refresh
// a tourné mais n'a trouvé aucune activité nouvelle (health/news recalculés
// quand même, fields inchangés).
export type RefreshSourceStat = { new: number; error?: string | null };
export type RefreshReport = {
  refreshed_at: string;
  trigger?: "manual" | "cron";
  health_before: number | null;
  health_after: number | null;
  new_activity_count: number;
  // `before` / `after` : valeurs avant et après, pour l'Undo. overrode_manual :
  // la valeur remplacée avait été éditée à la main (source plus récente).
  changed_fields: Array<{
    section: SectionKey;
    key: string;
    label: string;
    before?: unknown;
    after?: unknown;
    overrode_manual?: boolean;
  }>;
  // Compteurs par source (nouveau depuis le refresh précédent) + erreur
  // éventuelle : une source KO s'affiche comme telle, jamais comme un 0.
  sources?: {
    claap?: RefreshSourceStat;
    hubspot?: RefreshSourceStat;
    slack?: RefreshSourceStat & { channel?: string | null };
    news?: RefreshSourceStat;
  };
  // Meetings Claap retenus automatiquement à ce refresh (plus de popup de
  // confirmation) : listés dans What's new avec "Not this account".
  auto_added_meetings?: Array<{ recording_id: string; meeting_title: string | null; meeting_started_at: string | null }>;
  notes?: string[];
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

// ── Checklist HubSpot (colonne gauche de la fiche) ────────────────────────
// Champs du deal HubSpot qu'on surveille et qu'on propose de remplir quand ils
// sont vides apres le closed-won. Source de verite unique : ajouter une entree
// ici suffit a la faire apparaitre dans la checklist (fetch GET + suggestion IA
// + ecriture). Les `property` / `type` / `options` proviennent directement de
// l'API HubSpot (deal properties de ce portail) -> "Valider" ecrit une valeur
// toujours valide (pour les enums, la valeur ecrite est une option valide).
export type HubspotFieldType = "string" | "number" | "date" | "enumeration";
export type HubspotFieldOption = { value: string; label: string };
export type HubspotChecklistFieldDef = {
  property: string;
  label: string;
  type: HubspotFieldType;
  // Groupe d'affichage (calque les cards de la fiche deal HubSpot).
  group: "qualification" | "deal_info" | "general_info" | "contract_billing";
  options?: readonly HubspotFieldOption[];
};

// Helper : option ou value === label.
const o = (v: string, l?: string): HubspotFieldOption => ({ value: v, label: l ?? v });

export const HUBSPOT_CHECKLIST_FIELDS: readonly HubspotChecklistFieldDef[] = [
  // ── Qualification (card "About this deal") ──
  { property: "dealtype", label: "Deal Type", type: "enumeration", group: "qualification", options: [o("newbusiness", "New Business"), o("existingbusiness", "Existing Business")] },
  { property: "project_type", label: "Project Type", type: "enumeration", group: "qualification", options: [o("Generic Deal"), o("Human Coaching Deal"), o("AI Coaching Deal")] },
  { property: "amount", label: "Amount", type: "number", group: "qualification" },
  { property: "estimated_budget", label: "Estimated budget", type: "number", group: "qualification" },
  { property: "closedate", label: "Close Date", type: "date", group: "qualification" },
  { property: "authority", label: "Authority", type: "enumeration", group: "qualification", options: [o("Décideur identifié et accessible"), o("Décideur identifié mais non accessible"), o("Influenceur ou prescripteur uniquement"), o("Comité de décision / plusieurs acteurs"), o("Autorité inconnue / à identifier")] },
  { property: "champion", label: "Champion", type: "enumeration", group: "qualification", options: [o("Identified decision-maker sponsor + active internal champion"), o("Sponsor identified but low level of commitment"), o("Champion identified but no sponsor confirmed"), o("Partial authority / unmapped committee"), o("Unknown authority / unclear"), o("Executive Sponsor + HR + Early Procurement Approval"), o("HR sponsor identified"), o("Junior HR / without executive sponsorship"), o("Designated L&D or Digital Sponsor"), o("Business + IT sponsor involved"), o("Innovation only without industry sponsorship")] },
  { property: "budget_confirmed", label: "Budget", type: "enumeration", group: "qualification", options: [o("Approved budget / existing budget line"), o("Budget identified but not approved"), o("The budget depends on a business case or pilot project"), o("Exploration without a budget"), o("Budget test / probable pilot"), o("No budget planned"), o("Approved budget + established procurement process"), o("Budget approved without a clear process"), o("Estimated budget"), o("No budget / Budget rejected"), o("Innovation budget approved")] },
  { property: "need", label: "Need", type: "enumeration", group: "qualification", options: [o("Critical Business Need", "Quantified business pain (turnover, performance, M&A, etc.)"), o("Interest in innovation / exploration"), o("Clear but unquantified strategic pain"), o("Program related to strategic transformation (M&A, restructuring, executive alignment)"), o("Structured Leadership Program"), o("Individual request / one-time request"), o("Immediate operational use cases (feedback, performance reviews, M&A, restructuring)"), o("Need a scale post-training"), o("Interest in AI research"), o("Nice to Have / Simple curiosity")] },
  { property: "needs", label: "Need detailed", type: "string", group: "qualification" },
  { property: "timeline", label: "Timeline", type: "enumeration", group: "qualification", options: [o("Moins de 1 mois", "Decision confirmed by sponsor <1 month"), o("1-3 mois", "1-3 months with next step planned"), o("3-6 mois", "3-6 months structured"), o("+6 mois", ">6 months or unclear")] },
  { property: "stategic_fit", label: "Strategic Fit", type: "enumeration", group: "qualification", options: [o("Mid-market"), o("Not ICP or weak expansion potential"), o("Single BU"), o("One shot / isolated test"), o("Enterprise multi-entity")] },
  { property: "hs_next_step", label: "Next step", type: "string", group: "qualification" },
  // ── Deal information ──
  { property: "integration", label: "Integration", type: "enumeration", group: "deal_info", options: [o("Slack"), o("Teams"), o("None")] },
  { property: "number_of_credits", label: "Number of credits", type: "number", group: "deal_info" },
  { property: "challenges", label: "Challenges", type: "enumeration", group: "deal_info", options: [o("Development of high potentials talents"), o("Transformation of organizations"), o("Leadership Development"), o("Women Leadership"), o("Organizational transformation"), o("Development of a coaching culture"), o("Well-being and resilience"), o("IA Coaching"), o("Internal Coaching")] },
  { property: "product", label: "Product", type: "enumeration", group: "deal_info", options: [o("Coaching"), o("IA Coaching"), o("Workshop"), o("White Label")] },
  { property: "hs_acv", label: "Annual contract value", type: "number", group: "deal_info" },
  { property: "origin", label: "Source", type: "enumeration", group: "deal_info", options: [o("Linkedin"), o("Cold call"), o("Email"), o("Referral"), o("Tradeshows"), o("Webinar"), o("Partnerships")] },
  // ── General information ──
  { property: "main_hr_contact", label: "Main HR Contact", type: "string", group: "general_info" },
  { property: "operational_hr_contact", label: "Operational HR Contact", type: "string", group: "general_info" },
  { property: "other_information", label: "Other information", type: "string", group: "general_info" },
  // ── Contract & billing ──
  { property: "contract_signatory_contact", label: "Contract Signatory Contact", type: "string", group: "contract_billing" },
  { property: "duration_of_contract", label: "Duration of Contract", type: "enumeration", group: "contract_billing", options: [o("1 year"), o("2 years"), o("3 years")] },
  { property: "contract_start_date", label: "Contract Start Date", type: "date", group: "contract_billing" },
  { property: "contract_end_date", label: "Contract End Date", type: "date", group: "contract_billing" },
  { property: "total_budget", label: "Total Budget", type: "number", group: "contract_billing" },
  { property: "billing", label: "Billing", type: "enumeration", group: "contract_billing", options: [o("Upfront"), o("Purchase Order")] },
  { property: "billing_contact", label: "Billing Contact", type: "string", group: "contract_billing" },
  { property: "billing_address", label: "Billing Address", type: "string", group: "contract_billing" },
  { property: "payment_deadline", label: "Payment Deadline", type: "date", group: "contract_billing" },
];

export function getHubspotFieldDef(property: string): HubspotChecklistFieldDef | undefined {
  return HUBSPOT_CHECKLIST_FIELDS.find((f) => f.property === property);
}

// Valeurs courantes des champs surveilles, lues en live sur le deal HubSpot par
// le GET /api/clients/[id] (non persiste). null si non lu (HubSpot KO ou client
// non enrichi). Sert a deriver "rempli vs manquant".
export type HubspotDealFields = Record<string, string | null>;

// Suggestion IA de remplissage pour un champ HubSpot vide. Persiste dans
// clients.hubspot_field_suggestions.
export type HubspotFieldSuggestion = {
  property: string;
  label: string;
  suggestion: string;
  rationale: string;
};

export type HubspotFieldSuggestions = {
  generated_at: string;
  fields: HubspotFieldSuggestion[];
};

// ── Checklist onboarding (colonne gauche de la fiche) ─────────────────────
// Un item = une tache d'onboarding, rattachee a une section. Etat coche
// persiste dans clients.onboarding_checklist. Checklist 100 % manuelle : items
// issus d'un template de base, coches a la main. La `section` sert au regroupe-
// ment dans l'UI ; le `key` (stable) au merge qui preserve l'etat coche.
export type OnboardingItem = {
  key: string;
  label: string;
  category: string; // niveau 1 (ex: "Set up IT", "Onboarding client")
  section: string; // niveau 2 (sous-categorie, ex: "Groups", "Acculturation")
  done: boolean;
  done_at: string | null;
};

export type OnboardingChecklist = {
  items: OnboardingItem[];
  // Masque la card onboarding pour ce compte (ex: client onboarde il y a
  // longtemps, ou inutile pour le CSM). Reaffichable depuis le header de la fiche.
  dismissed?: boolean;
};

// ── Email "demander les infos manquantes" (cache) ─────────────────────────
// Genere une fois puis persiste (clients.missing_info_email_draft). Reutilise
// tel quel a l'ouverture de la modal ; regenere seulement sur action explicite.
export type MissingInfoEmailDraft = {
  to: string;
  subject: string;
  body: string;
  missing: string[];
  generated_at: string;
};

// Template de base, sur deux niveaux : categorie (niveau 1) > sous-categorie
// (niveau 2) > items. "Set up IT" = tout ce qui se parametre dans Coachello (avec
// ses sous-categories), "Onboarding client" = le process cote client/CS. `key`
// stable : sert au merge qui preserve l'etat coche. Libelles en EN (UI fiche).
export const ONBOARDING_CHECKLIST_TEMPLATE: ReadonlyArray<{
  category: string;
  section: string;
  items: ReadonlyArray<{ key: string; label: string }>;
}> = [
  // ── Set up IT (config Coachello, sous-categories conservees) ──
  {
    category: "Set up IT",
    section: "Company creation",
    items: [
      { key: "company_coaching_type", label: "Coaching type: Human, AI or Hybrid?" },
      { key: "company_support", label: "Support: Teams, Slack or Web" },
      { key: "company_setup_app_it", label: "Set up app with IT (if Teams or Slack)" },
      { key: "company_meeting_provider", label: "Meeting provider: Teams, Google or Custom" },
      { key: "company_billing_method", label: "Billing / credits method (credit, license used, license type, exec or not?)" },
      { key: "company_contract_start", label: "Contract start date" },
    ],
  },
  {
    category: "Set up IT",
    section: "Admins",
    items: [
      { key: "admins_hr_global", label: "Add global HR admins" },
      { key: "admins_it", label: "Add IT admin (optional)" },
    ],
  },
  {
    category: "Set up IT",
    section: "Groups",
    items: [
      { key: "groups_or_program", label: "Groups or program" },
      { key: "groups_create", label: "Create group / program" },
      { key: "groups_languages", label: "Group languages" },
      { key: "groups_admins", label: "Group admins" },
      { key: "groups_limit_user", label: "Limit / user" },
      { key: "groups_add_coaches", label: "Add coaches per program" },
      { key: "groups_internal_coach", label: "Internal coach" },
      { key: "groups_tripartite", label: "Tripartite / quadripartite" },
      { key: "groups_label", label: "Label" },
    ],
  },
  {
    category: "Set up IT",
    section: "Licenses & credits",
    items: [{ key: "licenses_add", label: "Add per group or program" }],
  },
  {
    category: "Set up IT",
    section: "Customization",
    items: [
      { key: "custom_email_setup", label: "Email set-up" },
      { key: "custom_dashboard_categories", label: "Dashboard categories" },
      { key: "custom_auto_assessment", label: "Auto assessment" },
      { key: "custom_impact_assessment", label: "Impact assessment" },
      { key: "custom_peer_feedback", label: "Peer feedback (360)" },
      { key: "company_orientation_call", label: "Orientation call" },
    ],
  },
  // ── Onboarding client (process, sous-categories) ──
  {
    category: "Onboarding client",
    section: "Handover & scoping",
    items: [
      { key: "contract_signature", label: "Contract signature" },
      { key: "handover_cs_lead_coach", label: "Handover Amélie (CS/Lead coach)" },
      { key: "scoping_meeting_hr_kpi", label: "Scoping meeting with HR (KPI definition)" },
    ],
  },
  {
    category: "Onboarding client",
    section: "Communication",
    items: [
      { key: "slack_channel_client_brief", label: "Slack channel creation + Client brief" },
      { key: "communication_kit", label: "Communication kit (Kick off presentation, User guide, emails)" },
    ],
  },
  {
    category: "Onboarding client",
    section: "Acculturation",
    items: [
      { key: "meetings_hr_acculturation", label: "HR acculturation & onboarding" },
      { key: "meetings_coach_acculturation", label: "Coach acculturation" },
    ],
  },
  {
    category: "Onboarding client",
    section: "Launch",
    items: [
      { key: "meetings_cohort_launch", label: "Cohort launch (coachees), or video if individual" },
      { key: "kickoff_time_selected", label: "Kick off time selected" },
      { key: "send_user_guide", label: "Send user guide" },
      { key: "invoice_sent", label: "Invoice sent" },
    ],
  },
  {
    category: "Onboarding client",
    section: "Test",
    items: [
      { key: "test_admin_global", label: "Test by adding yourself as global admin" },
      { key: "test_sub_admin_group", label: "Test by adding yourself as sub-admin / group admin" },
      { key: "test_coachee", label: "Test by adding yourself as coachee (switch to coachee)" },
      { key: "test_group_emails", label: "Test by adding yourself to a group (to test emails)" },
      { key: "test_live_client", label: "Live test with the client" },
    ],
  },
] as const;

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
  // Ancien flux de confirmation des nouveaux meetings au refresh (abandonné :
  // ils sont désormais retenus automatiquement). Colonne conservée, plus lue.
  pending_refresh_meeting_candidates: MeetingCandidate[] | null;
  // Recordings retirés à la main ("Not this account") : exclus définitivement
  // de la discovery pour ce client.
  declined_claap_recording_ids: string[] | null;
  last_enriched_at: string | null;
  last_health_run_at: string | null;
  last_news_run_at: string | null;
  last_refreshed_at: string | null;
  last_refresh_report: RefreshReport | null;
  owner_notified_at: string | null;
  // Dernière édition manuelle du coach brief : le refresh ne le régénère pas
  // s'il a été retouché depuis la dernière génération.
  coach_brief_edited_at: string | null;
  // Handover AM/CS : l'AE assigne un Account Manager et un Customer Success et
  // les notifie sur Slack une fois la fiche complète. Cf. notify-handover.ts.
  am_email: string | null;
  am_name: string | null;
  cs_email: string | null;
  cs_name: string | null;
  am_cs_notified_at: string | null;
  billing: Billing | null;
  billing_refreshed_at: string | null;
  // Checklists colonne gauche (cf. migration clients_checklists.sql).
  hubspot_field_suggestions: HubspotFieldSuggestions | null;
  onboarding_checklist: OnboardingChecklist | null;
  // Brouillon (cache) de l'email "demander les infos manquantes" : on le persiste
  // pour ne pas le regenerer a chaque ouverture de la modal (cf. migration).
  missing_info_email_draft: MissingInfoEmailDraft | null;
  // Valeurs courantes des champs HubSpot surveilles, injectees par le GET
  // (best-effort, non persiste). Absent si le client n'est pas enrichi ou si
  // HubSpot a echoue.
  hubspot_deal_fields?: HubspotDealFields | null;
  created_at: string;
  updated_at: string;
};

// Un champ HubSpot est "vide" (a remplir) si null/undefined ou string vide.
export function isHubspotFieldEmpty(value: string | null | undefined): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

// Champs HubSpot surveilles actuellement vides, derives des valeurs live.
// Renvoie les definitions completes (property/label/type/options) pour que l'UI
// rende le bon input (dropdown enum, date, number, texte).
export function getMissingHubspotFields(
  dealFields: HubspotDealFields | null | undefined,
): HubspotChecklistFieldDef[] {
  if (!dealFields) return [];
  return HUBSPOT_CHECKLIST_FIELDS.filter((f) => isHubspotFieldEmpty(dealFields[f.property]));
}

// Fusionne le template de base (sections aplaties) avec l'etat persiste, en
// preservant l'etat `done` par `key`. Utilise par l'UI et la route PATCH.
export function mergeOnboardingItems(
  persisted: OnboardingChecklist | null | undefined,
): OnboardingItem[] {
  const persistedByKey = new Map((persisted?.items ?? []).map((i) => [i.key, i]));
  const result: OnboardingItem[] = [];
  for (const group of ONBOARDING_CHECKLIST_TEMPLATE) {
    for (const base of group.items) {
      const prev = persistedByKey.get(base.key);
      result.push({
        key: base.key,
        label: base.label,
        category: group.category,
        section: group.section,
        done: prev?.done ?? false,
        done_at: prev?.done_at ?? null,
      });
    }
  }
  // On NE garde PAS les items persistes orphelins (anciens `key` de templates
  // precedents) : le template est la seule source de verite, sinon ils
  // apparaitraient dans un bucket "Other". Leur etat coche stale est ignore.
  return result;
}

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

// ── Champs requis / recommandés (handover AM/CS) ──────────────────────────
// Source de vérité = flags `required`/`recommended` dans SECTION_DEFINITIONS.
// Réutilisé côté client (panneau handover + surlignage) et serveur (garde-fou
// de la route notify-handover).

export type MissingFieldRef = { section: SectionKey; key: string; label: string };

// Une valeur de field est "vide" si null/undefined, array vide, ou string vide.
// Même logique que renderValue() dans field-display.tsx.
function isFieldEmpty(field: unknown): boolean {
  const value = (field as ClientFieldValue | undefined)?.value;
  if (value === null || value === undefined) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === "string" && !value.trim()) return true;
  return false;
}

function missingFieldsByFlag(
  fields: Partial<ClientFields>,
  flag: "required" | "recommended",
): MissingFieldRef[] {
  const missing: MissingFieldRef[] = [];
  for (const section of SECTION_DEFINITIONS) {
    const sectionData = (fields[section.key] ?? {}) as Record<string, unknown>;
    for (const fieldDef of section.fields) {
      if (!fieldDef[flag]) continue;
      if (isFieldEmpty(sectionData[fieldDef.key])) {
        missing.push({ section: section.key, key: fieldDef.key, label: fieldDef.label });
      }
    }
  }
  return missing;
}

export function getMissingRequiredFields(fields: Partial<ClientFields>): MissingFieldRef[] {
  return missingFieldsByFlag(fields, "required");
}

export function getMissingRecommendedFields(fields: Partial<ClientFields>): MissingFieldRef[] {
  return missingFieldsByFlag(fields, "recommended");
}

// Types partagés de Prospecting v2 (client + serveur). Les noms de colonnes DB
// restent en snake_case dans les *Row ; les DTO d'API sont en camelCase.
// Module pur : aucun import serveur ici (utilisé par les composants client).

// ── Séquence ────────────────────────────────────────────────────────────────

export type StepKind = "email" | "linkedin_visit" | "linkedin_invite" | "linkedin_message" | "call" | "task";
export type ThreadMode = "new" | "reply";
export type StepMode = "ai" | "template";
export type StepLength = "short" | "standard" | "long";
export type AngleKey =
  | "problem"
  | "timeline"
  | "numbers"
  | "social_proof"
  | "insight"
  | "trigger"
  | "referral"
  | "breakup"
  | "custom";

export interface StepConfig {
  mode: StepMode;
  angle: AngleKey;
  /** Consignes libres pour l'IA (mode ai) ou note interne (mode template). */
  instructions: string;
  /** Mode template : texte avec variables {{firstName}}... */
  template: { subject: string; body: string };
  length: StepLength;
  /** CTA souhaité (ex. "15-min call next week"). Vide = l'IA choisit. */
  cta: string;
  /** Étape manuelle : la suite de la séquence attend que la tâche soit faite. */
  waitForCompletion: boolean;
}

/** Étape côté éditeur / template (pas encore persistée ou sans id). */
export interface StepDraft {
  id?: string;
  kind: StepKind;
  delayDays: number;
  threadMode: ThreadMode;
  config: StepConfig;
}

export interface StepRow {
  id: string;
  campaign_id: string;
  position: number;
  kind: StepKind;
  delay_days: number;
  thread_mode: ThreadMode;
  config: StepConfig;
  version: number;
  created_at: string;
  updated_at: string;
}

// ── Campagnes ───────────────────────────────────────────────────────────────

export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type CampaignLanguage = "auto" | "en" | "fr";

export interface SendWindow {
  timezone: string;
  /** 1 = lundi ... 7 = dimanche */
  days: number[];
  /** "HH:MM" */
  start: string;
  end: string;
}

export interface CampaignSettings {
  window: SendWindow;
  /** YYYY-MM-DD : pas d'envoi avant cette date (null = dès le lancement). */
  startDate: string | null;
  /** Nouveaux prospects démarrés par jour (étape 1). */
  newLeadsPerDay: number;
  /** Emails max par jour pour cette campagne (la boîte a aussi son cap). */
  maxEmailsPerDay: number;
  /** Chaque prospect doit être validé en Review avant tout envoi. */
  requireApproval: boolean;
  /** Une réponse d'un collègue (même domaine) stoppe tous les prospects de l'entreprise. */
  stopOnCompanyReply: boolean;
  /** Auto-réponse d'absence : pause jusqu'au retour au lieu de continuer. */
  pauseOnOoo: boolean;
  /** Bloque à l'ajout les prospects contactés par l'équipe il y a moins de N jours (0 = off). */
  skipIfContactedWithinDays: number;
  /** Au plus un premier contact par entreprise et par jour. */
  sameCompanyStagger: boolean;
  /** Signature Gmail du rep : sur le premier email, sur tous, ou aucune. */
  signature: "first" | "all" | "none";
  /** Cite le message précédent sous les relances en thread. */
  quotePrevious: boolean;
  /** L'IA termine le premier email par une phrase d'opt-out douce. */
  softOptOut: boolean;
  /** Log de chaque email envoyé / réponse reçue sur la timeline HubSpot. */
  hubspotLogEmails: boolean;
  /** Création des contacts absents de HubSpot au lancement (owner = le rep). */
  hubspotCreateContacts: boolean;
}

export type CampaignKind = "sequence" | "quick";

export interface CampaignRow {
  id: string;
  user_id: string;
  /** "quick" = lot de l'outil Quick email (une étape, caché de la liste des campagnes). */
  kind: CampaignKind;
  name: string;
  persona_id: string | null;
  goal: string;
  instructions: string;
  language: CampaignLanguage;
  status: CampaignStatus;
  pause_reason: string | null;
  settings: CampaignSettings;
  source_list_id: string | null;
  launched_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignStats {
  campaign_id: string;
  leads_total: number;
  leads_pending: number;
  leads_active: number;
  leads_contacted: number;
  leads_replied: number;
  leads_positive: number;
  leads_meetings: number;
  leads_bounced: number;
  leads_completed: number;
  leads_to_review: number;
  leads_generating: number;
  leads_outdated: number;
  leads_no_content: number;
  leads_error: number;
  leads_approved: number;
  emails_sent: number;
  tasks_due: number;
}

export interface CampaignListItem extends CampaignRow {
  stats: CampaignStats | null;
  steps_count: number;
  persona_name: string | null;
}

// ── Prospects ───────────────────────────────────────────────────────────────

export type ContactSource = "apollo" | "hubspot" | "csv" | "manual" | "list" | "watchlist" | "linkedin" | "referral";
export type ContactStatus =
  | "new"
  | "in_sequence"
  | "replied"
  | "interested"
  | "meeting"
  | "not_interested"
  | "bounced"
  | "unsubscribed"
  | "do_not_contact";
export type EmailStatus = "verified" | "guessed" | "unverified" | "invalid" | "bounced";

export interface ContactRow {
  id: string;
  email: string | null;
  email_lower: string | null;
  email_status: EmailStatus | null;
  first_name: string;
  last_name: string;
  title: string | null;
  seniority: string | null;
  company_name: string | null;
  company_domain: string | null;
  linkedin_url: string | null;
  linkedin_username: string | null;
  phone: string | null;
  location: string | null;
  country: string | null;
  industry: string | null;
  company_size: string | null;
  persona_id: string | null;
  hubspot_contact_id: string | null;
  hubspot_company_id: string | null;
  scope_company_id: string | null;
  apollo_id: string | null;
  source: ContactSource;
  custom_fields: Record<string, string>;
  status: ContactStatus;
  research: ContactResearch | null;
  research_at: string | null;
  research_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Prospect normalisé, quelle que soit la source (Apollo, HubSpot, CSV, manuel...). */
export interface LeadInput {
  email?: string | null;
  emailStatus?: EmailStatus | null;
  firstName: string;
  lastName: string;
  title?: string | null;
  seniority?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  linkedinUrl?: string | null;
  phone?: string | null;
  location?: string | null;
  country?: string | null;
  industry?: string | null;
  companySize?: string | null;
  hubspotContactId?: string | null;
  hubspotCompanyId?: string | null;
  scopeCompanyId?: string | null;
  apolloId?: string | null;
  source: ContactSource;
  customFields?: Record<string, string>;
}

export type PrecheckVerdict =
  | "add"
  | "duplicate_in_batch"
  | "already_in_campaign"
  | "active_elsewhere"
  | "recently_contacted"
  | "existing_client"
  | "suppressed"
  | "missing_email"
  | "invalid";

export interface PrecheckRow {
  index: number;
  lead: LeadInput;
  verdict: PrecheckVerdict;
  /** Un verdict bloquant ne peut pas être forcé (suppression, déjà en séquence...). */
  blocking: boolean;
  detail: string | null;
  contactId: string | null;
}

export interface PrecheckSummary {
  rows: PrecheckRow[];
  counts: Record<PrecheckVerdict, number>;
}

// ── Recherche (research) ────────────────────────────────────────────────────

export type HookKind = "post" | "news" | "hiring" | "career" | "crm" | "company";

export interface ResearchHook {
  text: string;
  kind: HookKind;
  sourceUrl?: string | null;
  date?: string | null;
  /** 1 = faible, 3 = très fort (récent, spécifique, lié au persona). */
  strength: 1 | 2 | 3;
}

export interface ResearchBrief {
  summary: string;
  hooks: ResearchHook[];
  pains: string[];
  personaFit: { score: number; reason: string };
  suggestedAngle: string;
  language: "en" | "fr";
  doNotMention: string[];
}

export interface ResearchSource {
  label: string;
  url?: string | null;
  date?: string | null;
}

export interface ContactResearch {
  brief: ResearchBrief | null;
  /** Faits bruts injectés dans le prompt d'écriture (texte). */
  facts: {
    linkedin?: string;
    posts?: string;
    company?: string;
    news?: string;
    hiring?: string;
    hubspot?: string;
    outreach?: string;
  };
  sources: ResearchSource[];
  /** Sources qui ont échoué (affichées, jamais masquées). */
  errors: string[];
  fetchedAt: string;
}

export interface CompanyResearch {
  linkedin: string;
  news: { title: string; url: string; date: string | null; snippet: string }[];
  jobs: { salesOpenings: number; total: number; sample: { title: string; location: string; url: string }[] } | null;
  errors: string[];
}

// ── Inscriptions & touches ──────────────────────────────────────────────────

export type EnrollmentStatus =
  | "pending"
  | "active"
  | "paused"
  | "replied"
  | "completed"
  | "bounced"
  | "unsubscribed"
  | "stopped"
  | "error";
export type EnrollmentOutcome = "interested" | "not_now" | "not_interested" | "meeting_booked" | "wrong_person";
export type ContentStatus = "none" | "queued" | "generating" | "ready" | "error" | "outdated";

export interface EnrollmentRow {
  id: string;
  campaign_id: string;
  contact_id: string;
  user_id: string;
  status: EnrollmentStatus;
  outcome: EnrollmentOutcome | null;
  content_status: ContentStatus;
  content_error: string | null;
  approved_at: string | null;
  approved_by: string | null;
  current_position: number;
  next_run_at: string | null;
  paused_until: string | null;
  pause_reason: string | null;
  stop_reason: string | null;
  started_at: string | null;
  last_activity_at: string | null;
  replied_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type TouchStatus = "draft" | "approved" | "sending" | "sent" | "due" | "done" | "skipped" | "canceled" | "failed";

export interface TouchVersion {
  subject: string | null;
  body: string | null;
  at: string;
  by: "ai" | "user";
}

export interface TouchProvenance {
  language?: "en" | "fr";
  angle?: string;
  hookUsed?: string | null;
  model?: string;
  knowledgeSource?: "notion" | "fallback";
  sources?: ResearchSource[];
  contexts?: string[];
}

export interface TouchRow {
  id: string;
  enrollment_id: string;
  step_id: string;
  campaign_id: string;
  user_id: string;
  kind: StepKind;
  position: number;
  subject: string | null;
  body: string | null;
  previous_versions: TouchVersion[];
  generated_step_version: number | null;
  edited_by_user: boolean;
  lint: LintIssue[] | null;
  provenance: TouchProvenance | null;
  status: TouchStatus;
  due_at: string | null;
  snoozed_until: string | null;
  attempts: number;
  last_error: string | null;
  claim_id: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  completed_at: string | null;
  task_outcome: string | null;
  task_note: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  rfc_message_id: string | null;
  hubspot_engagement_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Ligne du tableau Prospects d'une campagne (enrollment + contact + aperçu). */
export interface LeadListItem {
  enrollment: EnrollmentRow;
  contact: ContactRow;
  nextStep: { position: number; kind: StepKind } | null;
  emailsSent: number;
}

// ── Inbox ───────────────────────────────────────────────────────────────────

export type ReplyKind = "reply" | "auto_reply" | "bounce" | "colleague_reply";
export type ReplyCategory =
  | "interested"
  | "question"
  | "not_now"
  | "not_interested"
  | "wrong_person"
  | "unsubscribe"
  | "out_of_office"
  | "bounce_hard"
  | "bounce_soft"
  | "other";

export interface ReplyAi {
  oooReturnDate?: string | null;
  referral?: { name: string; email?: string | null; title?: string | null } | null;
  followUpDate?: string | null;
  suggestedAction?: string | null;
  language?: string | null;
}

export interface ReplyRow {
  id: string;
  user_id: string;
  enrollment_id: string | null;
  contact_id: string | null;
  campaign_id: string | null;
  touch_id: string | null;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  rfc_message_id: string | null;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  body: string | null;
  received_at: string;
  kind: ReplyKind;
  category: ReplyCategory | null;
  confidence: number | null;
  summary: string | null;
  ai: ReplyAi | null;
  classified_at: string | null;
  classify_error: string | null;
  handled_at: string | null;
  handled_by: string | null;
  created_at: string;
}

export interface InboxItem extends ReplyRow {
  contact: Pick<ContactRow, "id" | "first_name" | "last_name" | "title" | "company_name" | "email" | "linkedin_url" | "hubspot_contact_id"> | null;
  campaign: { id: string; name: string } | null;
}

// ── Tâches ──────────────────────────────────────────────────────────────────

export interface TaskItem {
  touch: TouchRow;
  contact: Pick<
    ContactRow,
    "id" | "first_name" | "last_name" | "title" | "company_name" | "email" | "phone" | "linkedin_url" | "hubspot_contact_id"
  >;
  campaign: { id: string; name: string };
  enrollmentStatus: EnrollmentStatus;
}

// ── Boîte d'envoi ───────────────────────────────────────────────────────────

export type MailboxProvider = "gmail" | "gmail_sender";
export type MailboxStatus = "active" | "paused" | "disconnected";

export interface MailboxRow {
  id: string;
  user_id: string;
  provider: MailboxProvider;
  email_address: string | null;
  from_name: string | null;
  timezone: string;
  daily_limit: number;
  status: MailboxStatus;
  paused_reason: string | null;
  paused_until: string | null;
  last_history_id: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
  lease_until: string | null;
  lease_owner: string | null;
  created_at: string;
  updated_at: string;
}

export interface MailboxHealth {
  mailbox: MailboxRow | null;
  gmailConnected: boolean;
  senderConnected: boolean;
  sentToday: number;
  bounceRate7d: number | null;
  sendMode: "off" | "allowlist" | "live";
}

// ── Personas ────────────────────────────────────────────────────────────────

export interface PersonaTargeting {
  titles: string[];
  excludeTitles: string[];
  seniorities: string[];
  departments: string[];
  companySizes: string[];
  industries: string[];
  locations: string[];
  /** Postes recrutés par l'entreprise qui signalent un besoin (ex. AE, SDR). */
  hiringTitles: string[];
}

export interface SourcedText {
  text: string;
  source?: string | null;
}

export interface PersonaMessaging {
  pains: string[];
  valueProps: string[];
  /** Seuls chiffres / clients autorisés dans les messages (sourcés). */
  proofPoints: SourcedText[];
  insights: SourcedText[];
  objections: { objection: string; answer: string }[];
  competitors: string[];
  ctas: string[];
  tone: string;
  examples: string[];
  /** Pages Notion (ids prospecting_knowledge) injectées pour ce persona. */
  knowledgePages: string[];
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  targeting: PersonaTargeting;
  messaging: PersonaMessaging;
  color: string | null;
  is_active: boolean;
  position: number;
  updated_at?: string;
}

// ── Lint ────────────────────────────────────────────────────────────────────

export type LintLevel = "error" | "warn" | "info";

export interface LintIssue {
  level: LintLevel;
  code: string;
  message: string;
  stepId?: string;
  position?: number;
}

export interface SequenceHealth {
  score: number;
  issues: LintIssue[];
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export type JobKind = "generate" | "research" | "apollo_reveal" | "linkedin_resolve";
export type JobStatus = "queued" | "running" | "done" | "error" | "canceled";

export interface JobProgress {
  total: number;
  done: number;
  errors: number;
  label?: string;
}

export interface JobRow {
  id: string;
  user_id: string;
  campaign_id: string | null;
  kind: JobKind;
  status: JobStatus;
  params: Record<string, unknown>;
  progress: JobProgress;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

// ── Événements ──────────────────────────────────────────────────────────────

export interface EventRow {
  id: string;
  user_id: string | null;
  campaign_id: string | null;
  enrollment_id: string | null;
  contact_id: string | null;
  touch_id: string | null;
  type: string;
  step_position: number | null;
  data: Record<string, unknown>;
  occurred_at: string;
}

// ── Templates ───────────────────────────────────────────────────────────────

export interface SequenceTemplate {
  key: string;
  name: string;
  description: string;
  personaId: string | null;
  system: boolean;
  steps: StepDraft[];
}

// ── Suppressions ────────────────────────────────────────────────────────────

export interface SuppressionRow {
  id: string;
  kind: "email" | "domain";
  value: string;
  reason: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

// ── Connaissance ────────────────────────────────────────────────────────────

export interface KnowledgeRow {
  id: string;
  kind: "notion" | "rag";
  title: string;
  url: string | null;
  content: string;
  error: string | null;
  fetched_at: string;
}

// ── Base prospects & reporting ──────────────────────────────────────────────

export interface ProspectListItem {
  contact: ContactRow;
  campaigns: {
    enrollmentId: string;
    campaignId: string;
    campaignName: string;
    status: EnrollmentStatus;
    outcome: EnrollmentOutcome | null;
  }[];
  lastActivityAt: string | null;
}

export interface StepStatsRow {
  campaign_id: string;
  step_id: string;
  position: number;
  kind: StepKind;
  sent: number;
  done: number;
  due: number;
  skipped: number;
  replies: number;
  bounces: number;
}

export interface CampaignReport {
  stats: CampaignStats | null;
  steps: StepStatsRow[];
  replyBreakdown: { category: string; count: number }[];
  daily: { date: string; sent: number; replies: number }[];
  errors: string[];
}

// ── Moteur d'envoi : synchro et tâches (tranche Moteur) ────────────────────

export interface SyncSummary {
  /** history = curseur Gmail History ; fallback = history expirée, relecture des threads ; init = premier passage. */
  mode: "history" | "fallback" | "init" | "skipped";
  scanned: number;
  replies: number;
  autoReplies: number;
  bounces: number;
  colleagueReplies: number;
  /** Le rep a répondu à la main dans un thread de séquence (prospect mis en pause). */
  manualReplies: number;
  error: string | null;
}

/** Réponse de POST /api/prospecting/mailbox/sync ("Check replies now"). */
export interface MailboxSyncResult {
  sync: SyncSummary;
  /** Nouvelles réponses humaines (prospect + collègue) trouvées par cette synchro. */
  newReplies: number;
  syncedAt: string;
}

export type TaskBucket = "overdue" | "today" | "upcoming" | "done";
export type TaskKindFilter = "linkedin" | "call" | "other";
export type TaskOutcome = "done" | "connected" | "no_answer" | "voicemail" | "replied" | "meeting_booked";

export interface TaskListItem extends TaskItem {
  bucket: TaskBucket;
  /** Échéance effective (report inclus) ou date estimée pour une tâche à venir (null = après la tâche en cours). */
  estimatedAt: string | null;
  /** Position actuelle de l'étape dans la séquence (les étapes ajoutées après coup décalent les positions). */
  stepPosition: number;
  stepCount: number;
  waitForCompletion: boolean;
}

/** Réponse de GET /api/prospecting/tasks. */
export interface TasksResponse {
  items: TaskListItem[];
  counts: { overdue: number; today: number; upcoming: number; doneToday: number };
}

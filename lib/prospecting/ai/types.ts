// Types propres à la tranche IA de Prospecting (Review, connaissance, jobs de
// génération). Module pur, importable côté client : aucun import serveur.
import type { CompanyResearch, ContactRow, EnrollmentRow, JobRow, KnowledgeRow } from "../types";

// ── Génération ──────────────────────────────────────────────────────────────

export type GenerateScope = "missing" | "outdated" | "errors" | "all";

export interface GenerateParams {
  campaignId: string;
  enrollmentIds?: string[];
  scope?: GenerateScope;
  force?: boolean;
}

/** Contenu d'une étape tel que renvoyé par le modèle (avant validation). */
export interface WrittenStep {
  position: number;
  subject: string | null;
  body: string;
  angle: string;
  hookUsed: string | null;
}

export interface WriteSequenceResult {
  enrollmentId: string;
  written: number;
  kept: number;
  skipped: number;
  language: "en" | "fr" | null;
  error: string | null;
}

// ── Review ──────────────────────────────────────────────────────────────────

export type ReviewFilter = "to_review" | "approved" | "attention" | "all";

export interface ReviewLintSummary {
  errors: number;
  warns: number;
  infos: number;
}

export type ReviewContact = Pick<
  ContactRow,
  | "id"
  | "first_name"
  | "last_name"
  | "email"
  | "title"
  | "company_name"
  | "company_domain"
  | "linkedin_url"
  | "hubspot_contact_id"
  | "persona_id"
  | "research_at"
>;

export interface ReviewQueueItem {
  enrollment: EnrollmentRow;
  contact: ReviewContact;
  lint: ReviewLintSummary;
  /** Touches avec du contenu (hors visites de profil). */
  touchesWithContent: number;
  editedTouches: number;
  /** Score de fit persona issu du brief de recherche (0-100), null si pas de brief. */
  fitScore: number | null;
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  counts: Record<ReviewFilter, number> & { noContent: number; generating: number };
  /** Étapes avec contenu dans la séquence (pour "N of M"). */
  contentSteps: number;
  running: JobRow | null;
}

// ── Recherche ───────────────────────────────────────────────────────────────

export type NewsFlavor = "hr" | "sales";

/** Ce qui est stocké dans prospecting_company_research.data (cache partagé). */
export interface CompanyResearchCache {
  linkedin: string;
  linkedinFetchedAt: string | null;
  jobs: CompanyResearch["jobs"];
  jobsFetchedAt: string | null;
  newsByFlavor: Partial<Record<NewsFlavor, { items: CompanyResearch["news"]; fetchedAt: string }>>;
  watchlist: string | null;
  /** Dernier échec par source : pas de nouveau scrape payant avant 24 h. */
  failedAt?: Partial<Record<"linkedin" | "jobs", string>>;
  errors: string[];
}

export interface CompanyResearchResult extends CompanyResearch {
  key: string;
  watchlist: string | null;
  fetchedAt: string;
  fromCache: boolean;
}

// ── Connaissance ────────────────────────────────────────────────────────────

/** Ligne de la liste Knowledge : contenu tronqué pour l'aperçu. */
export interface KnowledgeListItem extends KnowledgeRow {
  length: number;
  /** Personas qui injectent cette page dans leurs prompts. */
  usedBy: string[];
}

export interface KnowledgePageRef {
  id: string;
  title: string;
  fetchedAt: string | null;
  error: string | null;
}

// ── Régénération / quick email ──────────────────────────────────────────────

export interface QuickEmailDraft {
  subject: string;
  body: string;
}

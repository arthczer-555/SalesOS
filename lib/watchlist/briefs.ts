import { db } from "@/lib/db";
import type { CompanyPost } from "@/lib/brightdata/linkedin";

// `hubspot_recap` n'est plus un brief affiché : la donnée HubSpot est désormais
// un input interne de l'Analyse AE. On garde ses types (plus bas) car le fetch
// HubSpot les réutilise.
export type BriefKind = "ae_analysis" | "news";
export type BriefStatus = "idle" | "running" | "ok" | "error";

export interface BriefRow<TContent = unknown> {
  id: string;
  scope_company_id: string;
  kind: BriefKind;
  status: BriefStatus;
  content: TContent | null;
  error: string | null;
  model: string | null;
  started_at: string | null;
  completed_at: string | null;
  triggered_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Typed content shapes per kind ───────────────────────────────────────────

/** État de la relation avec le compte (v2, affiché en pill). */
export type AeRelationshipState =
  | "never_contacted"
  | "cold"
  | "warm"
  | "active"
  | "lost_deal";

/** Un contact à prioriser dans le compte, avec son message d'ouverture. */
export interface AeContact {
  name: string;
  role: string | null;
  rationale: string; // 1 phrase, ancrée sur un fait précis du contexte
  angle: string; // legacy v1 (vide en v2, remplacé par opening_message)
  /**
   * v2 : exemple de message d'ouverture complet, prêt à adapter, qui suit le
   * guide de prospection (signal réel, problème avant solution, 1 CTA).
   * Absent sur les analyses générées avant la v2.
   */
  opening_message?: string | null;
  /** v2 : objet de mail proposé pour l'opening_message. */
  opening_subject?: string | null;
  email: string | null;
  hubspot_id: string | null;
}

/**
 * Contact pré-sélectionné par l'AE avant la génération "Analysis + messages" :
 * restreint la rédaction des opening messages à ces seuls prospects (au lieu de
 * laisser l'IA choisir jusqu'à 10 contacts). Sous-ensemble des contacts HubSpot
 * du compte. Liste vide / absente = comportement historique (l'IA choisit).
 */
export interface AeTarget {
  name: string;
  role: string | null;
  email: string | null;
  hubspot_id: string | null;
}

/** Analyse AE : reco de prospection sur un compte (remplace l'ancienne synthèse IA). */
export interface AeAnalysisContent {
  /** v2 : état de la relation. Absent sur les anciennes analyses. */
  relationship_state?: AeRelationshipState | null;
  /** v2 : l'essentiel de la situation en 1 à 2 phrases. */
  state_summary?: string;
  strategy: string; // legacy v1 (2 à 4 paragraphes, vide en v2)
  /**
   * Histoire à raconter : accroche de social proof basée sur le secteur du
   * prospect et nos clients actuels (ex : "on coache déjà XXX dans votre
   * secteur"). Vide si aucun client comparable n'est connu.
   */
  story_to_tell: string;
  priority_contacts: AeContact[]; // classés par priorité
  next_actions: string[]; // legacy v1 (vide en v2, redondant avec les contacts)
  watch_outs: string[]; // risques / à éviter
  sources_used: {
    emails: boolean;
    news: boolean;
    sector: boolean;
    /** v2 : le modèle a complété avec sa connaissance générale de l'entreprise. */
    world_knowledge?: boolean;
  };
}

export interface NewsSignalSnapshot {
  id: string;
  type: string;
  title: string;
  url: string | null;
  created_at: string;
  excerpt: string | null;
}

export interface NewsContent {
  posts: CompanyPost[];
  signals: NewsSignalSnapshot[];
  /** Synthèse Claude du momentum marché (veille Bright Data). Null si rien d'exploitable. */
  intel_summary?: string | null;
  fetched_at: string;
  credits_used: number;
}

export interface HubspotCompanySnapshot {
  id: string;
  name: string | null;
  domain: string | null;
  industry: string | null;
  numberofemployees: number | null;
  city: string | null;
  country: string | null;
  lifecyclestage: string | null;
}

export interface HubspotDealSummary {
  id: string;
  dealname: string | null;
  dealstage: string | null;
  dealstage_label: string | null;
  amount: string | null;
  closedate: string | null;
  is_closed: boolean;
  is_closed_won: boolean;
  owner_email: string | null;
}

export interface HubspotEngagementSnapshot {
  type: "meeting" | "call" | "note" | "email";
  date: string | null;
  title: string | null;
  body: string;
  outcome: string | null;
  // Pour les emails uniquement : sens (entrant/sortant) et expéditeur.
  direction?: "in" | "out";
  from_email?: string | null;
}

export interface HubspotContactSnapshot {
  id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  jobtitle: string | null;
}

export interface HubspotRecapContent {
  hubspot_company_id: string | null;
  company: HubspotCompanySnapshot | null;
  deals: HubspotDealSummary[];
  engagements: HubspotEngagementSnapshot[];
  contacts: HubspotContactSnapshot[];
  truncated: boolean;
}

export type BriefContent<K extends BriefKind> = K extends "ae_analysis"
  ? AeAnalysisContent
  : K extends "news"
    ? NewsContent
    : never;

// ── DB helpers ──────────────────────────────────────────────────────────────

export async function getBriefs(scopeCompanyId: string): Promise<{
  ae_analysis: BriefRow<AeAnalysisContent> | null;
  news: BriefRow<NewsContent> | null;
}> {
  const { data } = await db
    .from("watchlist_company_briefs")
    .select("*")
    .eq("scope_company_id", scopeCompanyId);

  const rows = (data ?? []) as BriefRow[];
  return {
    ae_analysis: (rows.find((r) => r.kind === "ae_analysis") as BriefRow<AeAnalysisContent>) ?? null,
    news: (rows.find((r) => r.kind === "news") as BriefRow<NewsContent>) ?? null,
  };
}

/**
 * Marque le brief en running. Si une row existe déjà avec status='running'
 * et started_at < 5 min, renvoie { alreadyRunning: true } sans toucher la DB
 * (anti double-dispatch).
 */
export async function startBriefRun(params: {
  scopeCompanyId: string;
  kind: BriefKind;
  userId: string;
}): Promise<{ alreadyRunning: boolean; briefId: string }> {
  const { scopeCompanyId, kind, userId } = params;

  const { data: existing } = await db
    .from("watchlist_company_briefs")
    .select("id, status, started_at")
    .eq("scope_company_id", scopeCompanyId)
    .eq("kind", kind)
    .maybeSingle();

  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  if (
    existing &&
    existing.status === "running" &&
    existing.started_at &&
    new Date(existing.started_at).getTime() > fiveMinAgo
  ) {
    return { alreadyRunning: true, briefId: existing.id };
  }

  const startedAt = new Date().toISOString();
  const { data: upserted, error } = await db
    .from("watchlist_company_briefs")
    .upsert(
      {
        scope_company_id: scopeCompanyId,
        kind,
        status: "running",
        started_at: startedAt,
        completed_at: null,
        error: null,
        triggered_by_user_id: userId,
        updated_at: startedAt,
      },
      { onConflict: "scope_company_id,kind" }
    )
    .select("id")
    .single();

  if (error || !upserted) {
    throw new Error(`startBriefRun failed: ${error?.message ?? "unknown"}`);
  }

  return { alreadyRunning: false, briefId: upserted.id };
}

export async function finishBriefOk<K extends BriefKind>(params: {
  scopeCompanyId: string;
  kind: K;
  content: BriefContent<K>;
  model?: string | null;
}): Promise<void> {
  const completedAt = new Date().toISOString();
  await db
    .from("watchlist_company_briefs")
    .update({
      status: "ok",
      content: params.content,
      error: null,
      model: params.model ?? null,
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("scope_company_id", params.scopeCompanyId)
    .eq("kind", params.kind);
}

export async function finishBriefError(params: {
  scopeCompanyId: string;
  kind: BriefKind;
  error: string;
}): Promise<void> {
  const completedAt = new Date().toISOString();
  await db
    .from("watchlist_company_briefs")
    .update({
      status: "error",
      error: params.error,
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("scope_company_id", params.scopeCompanyId)
    .eq("kind", params.kind);
}

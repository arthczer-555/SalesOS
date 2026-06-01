import { db } from "@/lib/db";
import type { CompanyPost } from "@/lib/netrows";

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

/** Un contact à prioriser dans le compte, avec l'angle de prospection. */
export interface AeContact {
  name: string;
  role: string | null;
  rationale: string; // pourquoi cibler cette personne
  angle: string; // accroche / angle d'approche concret
  email: string | null;
  hubspot_id: string | null;
}

/** Analyse AE : reco de prospection sur un compte (remplace l'ancienne synthèse IA). */
export interface AeAnalysisContent {
  strategy: string; // 2 à 4 paragraphes : comment aborder ce compte
  priority_contacts: AeContact[]; // classés par priorité
  next_actions: string[];
  watch_outs: string[]; // risques / à éviter
  sources_used: {
    emails: boolean;
    news: boolean;
    sector: boolean;
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
  fetched_at: string;
  netrows_credits_used: number;
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

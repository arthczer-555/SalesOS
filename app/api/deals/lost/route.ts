import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { LOSS_ANALYSIS_SCHEMA_VERSION, normalizeDeclaredReason, type LossReasonKey } from "@/lib/deals/loss-analysis";

export const dynamic = "force-dynamic";

// Colonne "Closed lost" du board /deals : deals du Sales Pipeline passés en
// closed lost, par pages de 30 ("Show older" charge la suivante). Deux tris :
//  - par défaut, date de passage en closed lost (hs_v2_date_entered_closedlost),
//    le plus récent d'abord, lu dans HubSpot ;
//  - sort=reopen : date de relance suggérée par l'analyse de perte, la plus
//    proche d'abord (les relances échues en tête). Lu dans deal_loss_analyses
//    (seuls les deals analysés y figurent), puis complété par HubSpot.
// Hors totaux Pipeline / Weighted, calculés sur /api/deals/list.

const PAGE_SIZE = 30;
const PROPS = [
  "dealname", "dealstage", "amount", "closedate", "createdate", "hubspot_owner_id",
  "hs_lastmodifieddate", "notes_last_contacted", "deal_type",
  "closed_lost_reason", "hs_v2_date_entered_closedlost", "hs_is_closed_lost",
];

type SearchRes = {
  results?: { id: string; properties: Record<string, string | null> }[];
  paging?: { next?: { after?: string } };
  total?: number;
};

type AnalysisRow = { deal_id: string; status: string; primary_reason: string | null; reopen_date: string | null; schema_version: string | null };
type LossAnalysisSummary = { status: string; primaryReason: LossReasonKey | null; reopenDate: string | null };

// Champs lus dans le JSON de l'analyse (pas dans les colonnes de la migration
// deals_next_move_reopen_chat.sql) : le badge s'affiche même sans elle. La
// date de relance n'est exposée que pour une analyse au format courant.
const ANALYSIS_SELECT =
  "deal_id, status, primary_reason:analysis->>primaryReason, reopen_date:analysis->reopen->>date, schema_version:analysis->>schemaVersion";

function summarize(a: AnalysisRow): LossAnalysisSummary {
  return {
    status: a.status,
    primaryReason: (a.primary_reason as LossReasonKey | null) ?? null,
    reopenDate: a.schema_version === String(LOSS_ANALYSIS_SCHEMA_VERSION) ? a.reopen_date : null,
  };
}

// Page triée par date de relance : ordre et pagination viennent de la base,
// les propriétés des deals d'un batch/read HubSpot (30 ids, sous le plafond de 100).
async function reopenPage(ownerFilter: string, offset: number): Promise<{
  rows: { id: string; properties: Record<string, string | null> }[];
  analyses: Map<string, LossAnalysisSummary>;
  total: number;
  nextAfter: string | null;
}> {
  let query = db
    .from("deal_loss_analyses")
    .select(ANALYSIS_SELECT, { count: "exact" })
    .eq("status", "done")
    .not("reopen_date", "is", null)
    .order("reopen_date", { ascending: true })
    .order("deal_id", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);
  if (ownerFilter) query = query.eq("owner_id", ownerFilter);
  const { data, count, error } = await query;
  if (error) throw new Error(`Reopen sort unavailable (${error.message}). Apply the migration deals_next_move_reopen_chat.sql.`);
  const rows = (data ?? []) as AnalysisRow[];
  if (rows.length === 0) return { rows: [], analyses: new Map<string, LossAnalysisSummary>(), total: count ?? 0, nextAfter: null };

  const batch = await hubspotFetch<{ results?: { id: string; properties: Record<string, string | null> }[] }>(
    "/crm/v3/objects/deals/batch/read",
    "POST",
    { inputs: rows.map((r) => ({ id: r.deal_id })), properties: PROPS },
  );
  const byId = new Map((batch.results ?? []).map((d) => [d.id, d]));
  const total = count ?? rows.length;
  return {
    // Un deal rouvert depuis l'analyse n'a plus sa place dans la colonne.
    rows: rows
      .map((r) => byId.get(r.deal_id))
      .filter((d): d is NonNullable<typeof d> => !!d && d.properties.hs_is_closed_lost === "true"),
    analyses: new Map(rows.map((r) => [r.deal_id, summarize(r)])),
    total,
    nextAfter: offset + rows.length < total ? String(offset + PAGE_SIZE) : null,
  };
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ deals: [], nextAfter: null, total: 0, error: "Not authenticated" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const ownerParam = searchParams.get("owner"); // null = moi, "all" = tous, id = cet owner
  const q = searchParams.get("q")?.trim() ?? "";
  const after = searchParams.get("after");
  // La recherche texte passe par HubSpot : elle impose le tri par date de perte.
  const sortByReopen = searchParams.get("sort") === "reopen" && !q;

  let ownerFilter = "";
  if (ownerParam && ownerParam !== "all") {
    ownerFilter = ownerParam;
  } else if (!ownerParam) {
    const { data: userRow } = await db.from("users").select("hubspot_owner_id").eq("id", user.id).single();
    ownerFilter = userRow?.hubspot_owner_id ?? "";
  }

  try {
    if (sortByReopen) {
      const [page, owners] = await Promise.all([reopenPage(ownerFilter, Number(after) || 0), ownerNames()]);
      const deals = page.rows.map((d) => toLostDeal(d, owners, page.analyses));
      return NextResponse.json({ deals, nextAfter: page.nextAfter, total: page.total, error: null });
    }

    const filters: { propertyName: string; operator: string; value?: string }[] = [
      { propertyName: "pipeline", operator: "EQ", value: "default" },
      { propertyName: "hs_is_closed_lost", operator: "EQ", value: "true" },
    ];
    if (ownerFilter) filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerFilter });

    const [data, ownerMap] = await Promise.all([
      hubspotFetch<SearchRes>("/crm/v3/objects/deals/search", "POST", {
        limit: PAGE_SIZE,
        properties: PROPS,
        filterGroups: [{ filters }],
        sorts: [{ propertyName: "hs_v2_date_entered_closedlost", direction: "DESCENDING" }],
        ...(q ? { query: q } : {}),
        ...(after ? { after } : {}),
      }),
      ownerNames(),
    ]);
    const rows = data.results ?? [];

    // Statut de l'analyse de perte (badge sur la carte). Best-effort : sans la
    // table (migration non appliquée), la colonne s'affiche quand même.
    const analyses = new Map<string, LossAnalysisSummary>();
    if (rows.length > 0) {
      const { data: la } = await db
        .from("deal_loss_analyses")
        .select(ANALYSIS_SELECT)
        .in("deal_id", rows.map((r) => r.id));
      for (const a of (la ?? []) as AnalysisRow[]) analyses.set(a.deal_id, summarize(a));
    }

    const deals = rows.map((d) => toLostDeal(d, ownerMap, analyses));

    return NextResponse.json({ deals, nextAfter: data.paging?.next?.after ?? null, total: data.total ?? deals.length, error: null });
  } catch (e) {
    // Forme complète même en erreur : le fetcher SWR global ne lève pas sur un 500.
    return NextResponse.json(
      { deals: [], nextAfter: null, total: 0, error: e instanceof Error ? e.message : "HubSpot error" },
      { status: 500 },
    );
  }
}

async function ownerNames(): Promise<Record<string, string>> {
  const owners = await hubspotFetch<{ results?: { id: string; firstName?: string; lastName?: string }[] }>("/crm/v3/owners?limit=100")
    .catch(() => ({ results: [] as { id: string; firstName?: string; lastName?: string }[] }));
  return Object.fromEntries((owners.results ?? []).map((o) => [o.id, o.firstName ?? o.lastName ?? ""]));
}

function toLostDeal(
  d: { id: string; properties: Record<string, string | null> },
  ownerMap: Record<string, string>,
  analyses: Map<string, LossAnalysisSummary>,
) {
  const p = d.properties;
  return {
    id: d.id,
    dealname: p.dealname ?? "",
    dealstage: p.dealstage ?? "",
    amount: p.amount ?? "",
    closedate: p.closedate ?? "",
    createdate: p.createdate ?? "",
    probability: "",
    ownerId: p.hubspot_owner_id ?? "",
    ownerName: ownerMap[p.hubspot_owner_id ?? ""] ?? "",
    lastContacted: p.notes_last_contacted ?? "",
    lastModified: p.hs_lastmodifieddate ?? "",
    numContacts: 0,
    dealType: p.deal_type ?? "",
    score: null,
    reasoning: null,
    next_action: null,
    scoredAt: null,
    qualification: null,
    lostAt: p.hs_v2_date_entered_closedlost || p.closedate || "",
    declaredReason: normalizeDeclaredReason(p.closed_lost_reason),
    lossAnalysis: analyses.get(d.id) ?? null,
  };
}

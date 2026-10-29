import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { normalizeDeclaredReason, type LossReasonKey } from "@/lib/deals/loss-analysis";

export const dynamic = "force-dynamic";

// Colonne "Closed lost" du board /deals : deals du Sales Pipeline passés en
// closed lost, triés par date de passage (hs_v2_date_entered_closedlost), le
// plus récent d'abord, par pages de 30 ("Show older" charge la suivante).
// Hors totaux Pipeline / Weighted, calculés sur /api/deals/list.

const PAGE_SIZE = 30;
const PROPS = [
  "dealname", "dealstage", "amount", "closedate", "createdate", "hubspot_owner_id",
  "hs_lastmodifieddate", "notes_last_contacted", "deal_type",
  "closed_lost_reason", "hs_v2_date_entered_closedlost",
];

type SearchRes = {
  results?: { id: string; properties: Record<string, string | null> }[];
  paging?: { next?: { after?: string } };
  total?: number;
};

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ deals: [], nextAfter: null, total: 0, error: "Not authenticated" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const ownerParam = searchParams.get("owner"); // null = moi, "all" = tous, id = cet owner
  const q = searchParams.get("q")?.trim() ?? "";
  const after = searchParams.get("after");

  let ownerFilter = "";
  if (ownerParam && ownerParam !== "all") {
    ownerFilter = ownerParam;
  } else if (!ownerParam) {
    const { data: userRow } = await db.from("users").select("hubspot_owner_id").eq("id", user.id).single();
    ownerFilter = userRow?.hubspot_owner_id ?? "";
  }

  try {
    const filters: { propertyName: string; operator: string; value?: string }[] = [
      { propertyName: "pipeline", operator: "EQ", value: "default" },
      { propertyName: "hs_is_closed_lost", operator: "EQ", value: "true" },
    ];
    if (ownerFilter) filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerFilter });

    const [data, ownersData] = await Promise.all([
      hubspotFetch<SearchRes>("/crm/v3/objects/deals/search", "POST", {
        limit: PAGE_SIZE,
        properties: PROPS,
        filterGroups: [{ filters }],
        sorts: [{ propertyName: "hs_v2_date_entered_closedlost", direction: "DESCENDING" }],
        ...(q ? { query: q } : {}),
        ...(after ? { after } : {}),
      }),
      hubspotFetch<{ results?: { id: string; firstName?: string; lastName?: string }[] }>("/crm/v3/owners?limit=100")
        .catch(() => ({ results: [] as { id: string; firstName?: string; lastName?: string }[] })),
    ]);

    const ownerMap = Object.fromEntries((ownersData.results ?? []).map((o) => [o.id, o.firstName ?? o.lastName ?? ""]));
    const rows = data.results ?? [];

    // Statut de l'analyse de perte (badge "Analyzed" sur la carte). Best-effort :
    // sans la table (migration non appliquée), la colonne s'affiche quand même.
    const analyses = new Map<string, { status: string; primaryReason: LossReasonKey | null }>();
    if (rows.length > 0) {
      const { data: la } = await db
        .from("deal_loss_analyses")
        .select("deal_id, status, primary_reason:analysis->>primaryReason")
        .in("deal_id", rows.map((r) => r.id));
      for (const a of (la ?? []) as { deal_id: string; status: string; primary_reason: string | null }[]) {
        analyses.set(a.deal_id, { status: a.status, primaryReason: (a.primary_reason as LossReasonKey | null) ?? null });
      }
    }

    const deals = rows.map((d) => {
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
    });

    return NextResponse.json({ deals, nextAfter: data.paging?.next?.after ?? null, total: data.total ?? deals.length, error: null });
  } catch (e) {
    // Forme complète même en erreur : le fetcher SWR global ne lève pas sur un 500.
    return NextResponse.json(
      { deals: [], nextAfter: null, total: 0, error: e instanceof Error ? e.message : "HubSpot error" },
      { status: 500 },
    );
  }
}

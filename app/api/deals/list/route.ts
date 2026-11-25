import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { type DealScore } from "@/lib/deal-scoring";
import { db } from "@/lib/db";
import { PIPELINE_IDS, isTestDealName } from "@/lib/hubspot/pipeline-model";
import { hubspotSearchAll } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

async function hubspot(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

type RawDeal = { id: string; properties: Record<string, string> };

const DEAL_PROPS = [
  "dealname", "dealstage", "amount", "closedate", "createdate", "pipeline",
  "hubspot_owner_id", "hs_lastmodifieddate", "notes_last_contacted",
  "hs_deal_stage_probability", "num_associated_contacts",
  "deal_type", "description",
];

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const ownerParam = searchParams.get("owner"); // null = not set, "all" = no filter, id = filter by id
  const q = searchParams.get("q")?.trim() ?? "";
  // Deux boards depuis la bascule du 30/11 : Sales (défaut) et Prospection (les leads).
  const pipelineKey = searchParams.get("pipeline") === "prospection" ? "prospection" : "sales";

  // Resolve owner filter: if param not set, default to user's HubSpot owner id
  let ownerFilter = "";
  let myOwnerId: string | null = null;
  if (ownerParam === "all") {
    ownerFilter = "";
  } else if (ownerParam) {
    ownerFilter = ownerParam;
    myOwnerId = ownerParam;
  } else {
    // Default: fetch user's hubspot_owner_id
    const { data: userRow } = await db.from("users").select("hubspot_owner_id").eq("id", user.id).single();
    myOwnerId = userRow?.hubspot_owner_id ?? null;
    ownerFilter = myOwnerId ?? "";
  }

  try {
    // Fetch pipeline stages
    const pipelineData = await hubspot("/crm/v3/pipelines/deals");
    const pipelines: { id: string; label: string; stages: { id: string; label: string; displayOrder: number; metadata?: { probability?: string; isClosed?: string } }[] }[] =
      pipelineData.results ?? [];

    // Pipeline du board, par identifiant (jamais pipelines[0] : l'ordre renvoyé
    // par l'API n'est pas garanti). Stages fermés exclus.
    const defaultPipeline = pipelines.find((pl) => pl.id === PIPELINE_IDS[pipelineKey]);
    if (!defaultPipeline) {
      return NextResponse.json({ error: `HubSpot pipeline ${PIPELINE_IDS[pipelineKey]} not found`, stages: [], deals: [], pipelineTotal: 0, weightedTotal: 0, myOwnerId, owners: [] }, { status: 502 });
    }
    const stages = (defaultPipeline?.stages ?? [])
      .filter((s) => s.metadata?.isClosed !== "true")
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((s, i) => ({
        id: s.id,
        label: s.label,
        order: i,
        probability: s.metadata?.probability ? parseFloat(s.metadata.probability) : null,
      }));

    // Search active deals — restricted to the default pipeline so counts match the Kanban
    const filters: { propertyName: string; operator: string; value?: string }[] = [
      { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
    ];
    if (defaultPipeline?.id) {
      filters.push({ propertyName: "pipeline", operator: "EQ", value: defaultPipeline.id });
    }
    if (ownerFilter) {
      filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerFilter });
    }

    // Paginé (pages de 100, plafond 1000) : la vue "All owners" est celle par
    // défaut, un seul appel limité à 200 tronquait le board sans le dire.
    const [results, ownersData] = await Promise.all([
      hubspotSearchAll<RawDeal>("deals", {
        properties: DEAL_PROPS,
        filterGroups: [{ filters }],
        sorts: [{ propertyName: "amount", direction: "DESCENDING" }],
        ...(q ? { query: q } : {}),
      }),
      hubspot("/crm/v3/owners?limit=100").catch(() => ({ results: [] })),
    ]);

    const ownerMap: Record<string, string> = Object.fromEntries(
      ((ownersData.results ?? []) as { id: string; firstName?: string; lastName?: string }[])
        .map((o) => [o.id, o.firstName ?? o.lastName ?? ""])
    );

    // Les cartes "TEST - " (tests de la bascule) ne sont visibles que des admins.
    const visibleResults = results.filter((d) => user.is_admin || !isTestDealName(d.properties?.dealname));
    const rawDeals = visibleResults.map((d: RawDeal) => {
      const p = d.properties;
      return {
        id: d.id,
        dealname: p.dealname ?? "",
        dealstage: p.dealstage ?? "",
        amount: p.amount ?? "",
        closedate: p.closedate ?? "",
        createdate: p.createdate ?? "",
        probability: p.hs_deal_stage_probability ?? "",
        ownerId: p.hubspot_owner_id ?? "",
        ownerName: ownerMap[p.hubspot_owner_id ?? ""] ?? "",
        lastContacted: p.notes_last_contacted ?? "",
        lastModified: p.hs_lastmodifieddate ?? "",
        numContacts: p.num_associated_contacts ? parseInt(p.num_associated_contacts) : 0,
        dealType: p.deal_type ?? "",
      };
    });

    // Fetch cached AI scores from Supabase
    const dealIds = rawDeals.map((d: { id: string }) => d.id);
    let scoreMap: Record<string, { score: DealScore; reasoning: string; next_action: string; scored_at: string; qualification: Record<string, string | null> | null }> = {};
    if (dealIds.length > 0 && process.env.SUPABASE_URL) {
      const { data: cached } = await db
        .from("deal_scores")
        .select("deal_id, score, reasoning, next_action, qualification, scored_at")
        .in("deal_id", dealIds);
      scoreMap = Object.fromEntries(
        (cached ?? []).map((c: { deal_id: string; score: DealScore; reasoning: string; next_action: string; scored_at: string; qualification: Record<string, string | null> | null }) => [
          c.deal_id,
          { score: c.score, reasoning: c.reasoning, next_action: c.next_action, scored_at: c.scored_at, qualification: c.qualification ?? null },
        ])
      );
    }

    const deals = rawDeals.map((raw: typeof rawDeals[number]) => {
      const cached = scoreMap[raw.id];
      return {
        ...raw,
        score: cached?.score ?? null,
        reasoning: cached?.reasoning ?? null,
        next_action: cached?.next_action ?? null,
        scoredAt: cached?.scored_at ?? null,
        qualification: cached?.qualification ?? null,
      };
    });

    // Pipeline metrics
    const pipelineTotal = deals.reduce((sum: number, d: { amount: string }) => sum + (parseFloat(d.amount) || 0), 0);
    const weightedTotal = deals.reduce((sum: number, d: { amount: string; probability: string }) => {
      const prob = parseFloat(d.probability) || 0;
      return sum + (parseFloat(d.amount) || 0) * (prob / 100);
    }, 0);

    // Owners that appear in the current result set — used for multi-select filter
    const ownerIdsInDeals = Array.from(new Set(deals.map((d: { ownerId: string }) => d.ownerId).filter(Boolean) as string[]));
    const owners = ownerIdsInDeals
      .map((id) => ({ id, name: ownerMap[id] || "—" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ stages, deals, pipelineTotal, weightedTotal, myOwnerId, owners });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "HubSpot error" }, { status: 500 });
  }
}

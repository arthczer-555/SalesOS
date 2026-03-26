import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { type DealScore } from "@/lib/deal-scoring";
import { db } from "@/lib/db";

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

const DEAL_PROPS = [
  "dealname", "dealstage", "amount", "closedate", "pipeline",
  "hubspot_owner_id", "hs_lastmodifieddate", "notes_last_contacted",
  "hs_deal_stage_probability", "num_associated_contacts",
  "deal_type", "description",
];

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const ownerParam = searchParams.get("owner"); // null = not set, "all" = no filter, id = filter by id
  const q = searchParams.get("q")?.trim() ?? "";

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

    // Build ordered stages from first (default) pipeline, excluding closed stages
    const defaultPipeline = pipelines[0];
    const stages = (defaultPipeline?.stages ?? [])
      .filter((s) => s.metadata?.isClosed !== "true")
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((s, i) => ({
        id: s.id,
        label: s.label,
        order: i,
        probability: s.metadata?.probability ? parseFloat(s.metadata.probability) : null,
      }));

    // Search active deals
    const filters: { propertyName: string; operator: string; value?: string }[] = [
      { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
    ];
    if (ownerFilter) {
      filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerFilter });
    }

    const searchBody: Record<string, unknown> = {
      limit: 200,
      properties: DEAL_PROPS,
      filterGroups: [{ filters }],
      sorts: [{ propertyName: "amount", direction: "DESCENDING" }],
    };
    if (q) searchBody.query = q;

    const [data, ownersData] = await Promise.all([
      hubspot("/crm/v3/objects/deals/search", "POST", searchBody),
      hubspot("/crm/v3/owners?limit=100").catch(() => ({ results: [] })),
    ]);

    const ownerMap: Record<string, string> = Object.fromEntries(
      ((ownersData.results ?? []) as { id: string; firstName?: string; lastName?: string }[])
        .map((o) => [o.id, o.firstName ?? o.lastName ?? ""])
    );

    type RawDeal = { id: string; properties: Record<string, string> };

    const rawDeals = (data.results ?? []).map((d: RawDeal) => {
      const p = d.properties;
      return {
        id: d.id,
        dealname: p.dealname ?? "",
        dealstage: p.dealstage ?? "",
        amount: p.amount ?? "",
        closedate: p.closedate ?? "",
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
    let scoreMap: Record<string, { score: DealScore; reasoning: string; next_action: string; scored_at: string }> = {};
    if (dealIds.length > 0 && process.env.SUPABASE_URL) {
      const { data: cached } = await db
        .from("deal_scores")
        .select("deal_id, score, reasoning, next_action, scored_at")
        .in("deal_id", dealIds);
      scoreMap = Object.fromEntries(
        (cached ?? []).map((c: { deal_id: string; score: DealScore; reasoning: string; next_action: string; scored_at: string }) => [
          c.deal_id,
          { score: c.score, reasoning: c.reasoning, next_action: c.next_action, scored_at: c.scored_at },
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
      };
    });

    // Pipeline metrics
    const pipelineTotal = deals.reduce((sum: number, d: { amount: string }) => sum + (parseFloat(d.amount) || 0), 0);
    const weightedTotal = deals.reduce((sum: number, d: { amount: string; probability: string }) => {
      const prob = parseFloat(d.probability) || 0;
      return sum + (parseFloat(d.amount) || 0) * (prob / 100);
    }, 0);

    return NextResponse.json({ stages, deals, pipelineTotal, weightedTotal, myOwnerId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur HubSpot" }, { status: 500 });
  }
}

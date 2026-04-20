import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { scoreOneDeal } from "@/app/api/deals/score/route";

export const dynamic = "force-dynamic";
// Batch scoring can take a while — increase timeout to 5 minutes
export const maxDuration = 300;

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

export async function POST(req: NextRequest) {
  // Accept either a logged-in user OR the Vercel cron secret
  const cronSecret = process.env.CRON_SECRET;
  const cronHeader = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret && cronHeader === cronSecret;

  let userId: string | null = null;
  if (!isCron) {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    userId = user.id;
  }

  const body = await req.json().catch(() => ({}));
  const forceAll: boolean = body.forceAll ?? false;
  const explicitDealIds: string[] | undefined = Array.isArray(body.dealIds) ? body.dealIds : undefined;

  try {
    let dealIds: string[];
    if (explicitDealIds && explicitDealIds.length > 0) {
      dealIds = explicitDealIds;
    } else {
      const data = await hubspot("/crm/v3/objects/deals/search", "POST", {
        limit: 200,
        properties: ["dealname", "dealstage", "hs_is_closed"],
        filterGroups: [{ filters: [{ propertyName: "hs_is_closed", operator: "EQ", value: "false" }] }],
        sorts: [{ propertyName: "amount", direction: "DESCENDING" }],
      });
      dealIds = (data.results ?? []).map((d: { id: string }) => d.id);
    }

    let toScore = dealIds;
    if (!forceAll) {
      const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data: recent } = await db
        .from("deal_scores")
        .select("deal_id")
        .in("deal_id", dealIds)
        .gte("scored_at", cutoff);
      const recentIds = new Set((recent ?? []).map((r: { deal_id: string }) => r.deal_id));
      toScore = dealIds.filter((id) => !recentIds.has(id));
    }

    let scored = 0;
    let errors = 0;

    // Process in parallel batches of 5 to balance speed vs rate limits
    const BATCH_SIZE = 5;
    for (let i = 0; i < toScore.length; i += BATCH_SIZE) {
      const batch = toScore.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (dealId) => {
          const result = await scoreOneDeal(dealId, userId);
          await db.from("deal_scores").upsert({
            deal_id: dealId,
            score: { total: result.total, components: result.components, reliability: result.reliability },
            reasoning: result.reasoning,
            next_action: result.next_action,
            qualification: result.qualification ?? null,
            scored_at: new Date().toISOString(),
          }, { onConflict: "deal_id" });
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") scored++;
        else errors++;
      }
    }

    return NextResponse.json({
      total: dealIds.length,
      skipped: dealIds.length - toScore.length,
      scored,
      errors,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}

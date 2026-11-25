import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { scoreOneDeal, persistDealScore, DEFAULT_SCORE_MODEL } from "@/lib/deal-scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { dealId } = await req.json();
  if (!dealId) return NextResponse.json({ error: "dealId missing" }, { status: 400 });

  try {
    const { data: globalModelEntry } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").single();
    let scoreModel = DEFAULT_SCORE_MODEL;
    try { if (globalModelEntry?.content) scoreModel = (JSON.parse(globalModelEntry.content) as Record<string, string>).deals_score ?? DEFAULT_SCORE_MODEL; } catch { /* keep default */ }
    const result = await scoreOneDeal(dealId, user.id, scoreModel);

    const { kept } = await persistDealScore(dealId, result, { trigger: "manual" });
    // Carte synchronisée avec HubSpot : le score affiché reste celui de HubSpot,
    // le recalcul n'a rafraîchi que le reste (cf. persistDealScore).
    if (kept) {
      return NextResponse.json({ ...result, total: kept.total, components: kept.components, reliability: kept.reliability, scoreKept: true, recomputedTotal: result.total });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[deals/score] ERROR:", e instanceof Error ? e.stack : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}

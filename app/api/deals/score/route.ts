import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { scoreOneDeal, DEFAULT_SCORE_MODEL } from "@/lib/deal-scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { dealId } = await req.json();
  if (!dealId) return NextResponse.json({ error: "dealId manquant" }, { status: 400 });

  try {
    const { data: globalModelEntry } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").single();
    let scoreModel = DEFAULT_SCORE_MODEL;
    try { if (globalModelEntry?.content) scoreModel = (JSON.parse(globalModelEntry.content) as Record<string, string>).deals_score ?? DEFAULT_SCORE_MODEL; } catch { /* keep default */ }
    const result = await scoreOneDeal(dealId, user.id, scoreModel);

    await db.from("deal_scores").upsert({
      deal_id: dealId,
      score: { total: result.total, components: result.components, reliability: result.reliability },
      reasoning: result.reasoning,
      next_action: result.next_action,
      qualification: result.qualification ?? null,
      scored_at: new Date().toISOString(),
    }, { onConflict: "deal_id" });

    // Best-effort : persiste les événements clés (colonne ajoutée par la
    // migration deal_scores_key_events.sql — si absente, on n'échoue pas).
    if (result.key_events?.length) {
      const { error: keErr } = await db
        .from("deal_scores")
        .update({ key_events: result.key_events })
        .eq("deal_id", dealId);
      if (keErr) console.warn("[deals/score] key_events non persistés (migration ?):", keErr.message);
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("[deals/score] ERROR:", e instanceof Error ? e.stack : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}

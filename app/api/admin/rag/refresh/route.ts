import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { runRagInsightsRefresh } from "@/lib/rag-insights/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/admin/rag/refresh — relance l'analyse des tours de CoachelloAI.
//
// En prod (Netlify) : POST vers la background function (l'analyse LLM dépasse
// largement les ~26s d'une route sync). En local : run inline best-effort.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { sinceDays?: number };
  const sinceDays = typeof body.sinceDays === "number" ? body.sinceDays : 30;

  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);

  if (!isNetlifyEnv) {
    void runRagInsightsRefresh({ sinceDays }).catch((e) =>
      console.error("[rag/refresh] inline run failed:", e instanceof Error ? e.message : e),
    );
    return NextResponse.json({ ok: true, mode: "inline" }, { status: 202 });
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    return NextResponse.json({ error: "INTERNAL_SECRET missing" }, { status: 500 });
  }

  const triggerUrl = `${req.nextUrl.origin}/.netlify/functions/rag-insights-background`;
  try {
    const res = await fetch(triggerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ sinceDays, sendSlack: false }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      console.error(`[rag/refresh] bg trigger ${res.status}:`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[rag/refresh] bg trigger failed:", msg);
    }
  }

  return NextResponse.json({ ok: true, mode: "background" }, { status: 202 });
}

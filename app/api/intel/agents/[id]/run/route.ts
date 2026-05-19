import { NextRequest, NextResponse, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AGENT_BY_ID } from "@/lib/intel-agents";
import type { AgentId } from "@/lib/intel-types";
import { runLinkedinScan } from "@/lib/intel/run-linkedin-scan";
import { logAgentRun } from "@/lib/intel/log-agent-run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Mapping agentId → Netlify Background Function. Tous les agents listés ici
// sont déportés en BG fn sur Netlify pour éviter l'« Inactivity Timeout » du
// proxy (~26s sur Pro). Les BG fns logguent elles-mêmes dans
// intel_agent_run_logs + intel_agent_runs.
const BACKGROUND_FN_BY_AGENT: Partial<Record<AgentId, string>> = {
  "company-news": "intel-company-news-background",
  "funding-expansion": "intel-funding-background",
  "champion-tracker": "intel-champion-tracker-background",
  "competitor-activity": "intel-competitor-activity-background",
  "ads-activity": "intel-ads-background",
  "hiring-spike": "intel-hiring-spike-background",
};

// Fire-and-forget : on enregistre last_run_status = "running" + 202,
// l'exécution réelle se poursuit côté Netlify Background Function ou via
// `after()` en dev.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;
  const def = AGENT_BY_ID[id as AgentId];
  if (!def) return NextResponse.json({ error: "Agent inconnu" }, { status: 404 });
  if (!def.runEndpoint) {
    return NextResponse.json({ error: "Cet agent fonctionne en push, pas de run manuel." }, { status: 400 });
  }

  const startedAt = new Date().toISOString();
  await db
    .from("intel_agent_runs")
    .upsert(
      { user_id: user.id, agent_id: id, last_run_at: startedAt, last_run_status: "running", last_run_error: null },
      { onConflict: "user_id,agent_id" }
    );

  const userId = user.id;
  const baseUrl = req.nextUrl.origin;
  const cookie = req.headers.get("cookie") ?? "";
  const runEndpoint = def.runEndpoint;

  // ── Netlify : dispatch vers la BG fn dédiée si l'agent en a une ────────
  // Chaque BG fn logge elle-même son outcome dans intel_agent_runs +
  // intel_agent_run_logs, donc on n'a rien à faire ici à part 202.
  const siteUrl = process.env.URL ?? process.env.SITE_URL ?? baseUrl;
  const cronSecret = process.env.CRON_SECRET;
  const bgFn = BACKGROUND_FN_BY_AGENT[id as AgentId];
  if (bgFn && process.env.NETLIFY === "true" && cronSecret) {
    fetch(`${siteUrl}/.netlify/functions/${bgFn}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ userId, startedAt, triggeredBy: "manual" }),
    }).catch((e) => {
      console.error(`[intel/agents/run] background invoke failed for ${id}:`, e);
    });
    return NextResponse.json({ ok: true, queued: true, background: true }, { status: 202 });
  }

  // Dev local (pas de Background Functions dispo) : on garde le pattern
  // `after()` historique. Le scan sync risque d'être coupé à ~26s en prod si
  // jamais on tombe dans cette branche (agent sans BG fn mappée).
  after(async () => {
    let signalsCount = 0;
    let ok = true;
    let errorText: string | null = null;
    let payload: unknown = null;

    try {
      if (id === "company-news") {
        const result = await runLinkedinScan({ callerUserId: userId });
        signalsCount = result.analysis.signals_created;
        payload = result;
      } else {
        const res = await fetch(`${baseUrl}${runEndpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({}),
        });
        const text = await res.text();
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { raw: text.slice(0, 200) };
        }
        ok = res.ok;
        if (!ok) errorText = String(text).slice(0, 500);
        if (
          payload &&
          typeof payload === "object" &&
          "signalsCount" in payload &&
          typeof (payload as { signalsCount: unknown }).signalsCount === "number"
        ) {
          signalsCount = (payload as { signalsCount: number }).signalsCount;
        }
      }
    } catch (e) {
      ok = false;
      errorText = e instanceof Error ? e.message : String(e);
    }

    await db
      .from("intel_agent_runs")
      .upsert(
        {
          user_id: userId,
          agent_id: id,
          last_run_at: startedAt,
          last_run_status: ok ? "ok" : "error",
          last_run_signals_count: signalsCount,
          last_run_error: errorText,
        },
        { onConflict: "user_id,agent_id" }
      );

    await logAgentRun({
      agentId: id,
      triggeredBy: "manual",
      userId,
      startedAt,
      status: ok ? "ok" : "error",
      signalsCount,
      error: errorText,
      payload,
    });
  });

  return NextResponse.json({ ok: true, queued: true }, { status: 202 });
}

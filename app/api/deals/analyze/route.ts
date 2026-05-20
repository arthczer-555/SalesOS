import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runAndPersistDealAnalysis } from "@/lib/deals/run-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Si l'analyse persistée a moins que ce délai, on la sert sans relancer.
const FRESH_TTL_MS = 24 * 60 * 60 * 1000; // 24h
// Au-delà, on déclenche un re-run en arrière-plan tout en renvoyant la stale.
const STALE_RERUN_TTL_MS = FRESH_TTL_MS;

type DealAnalysisRow = {
  status: string;
  analysis: unknown;
  error_message: string | null;
  updated_at: string;
  model: string | null;
};

function shape(row: DealAnalysisRow | null) {
  if (!row) return { status: "none" as const, analysis: null, updatedAt: null, error: null };
  return {
    status: row.status,
    analysis: row.analysis,
    updatedAt: row.updated_at,
    error: row.error_message,
  };
}

async function fetchRow(dealId: string): Promise<DealAnalysisRow | null> {
  const { data } = await db
    .from("deal_analyses")
    .select("status, analysis, error_message, updated_at, model")
    .eq("deal_id", dealId)
    .maybeSingle();
  return (data as DealAnalysisRow | null) ?? null;
}

async function triggerBackground(req: NextRequest, dealId: string, userId: string): Promise<{ inlineDone: boolean; inlineError?: string }> {
  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);
  const isDev = process.env.NODE_ENV === "development";
  const useBackground = isNetlifyEnv && !isDev;

  if (useBackground) {
    const internalSecret = process.env.INTERNAL_SECRET;
    if (!internalSecret) {
      const msg = "INTERNAL_SECRET non configuré";
      console.error(`[deals/analyze/${dealId}] ${msg}`);
      return { inlineDone: false, inlineError: msg };
    }
    const siteUrl = req.nextUrl.origin;
    try {
      const bgRes = await fetch(`${siteUrl}/.netlify/functions/deals-analyze-background`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({ dealId, userId }),
        signal: AbortSignal.timeout(8000),
      });
      console.log(`[deals/analyze/${dealId}] bg trigger status:`, bgRes.status);
      if (bgRes.status !== 202 && !bgRes.ok) {
        const text = await bgRes.text().catch(() => "");
        const msg = `BG non-202 (${bgRes.status}): ${text.slice(0, 200)}`;
        return { inlineDone: false, inlineError: msg };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("aborted") && !msg.includes("timeout")) {
        console.error(`[deals/analyze/${dealId}] bg trigger failed:`, msg);
        return { inlineDone: false, inlineError: msg };
      }
    }
    return { inlineDone: false };
  }

  // Dev fallback : on attend la fin (Next dev n'a pas de timeout serverless),
  // ça permet de voir immédiatement le succès ou l'erreur côté client au lieu
  // de poller dans le vide. Le fire-and-forget se faisait flinguer par les
  // hot-reloads.
  console.log(`[deals/analyze/${dealId}] dev inline run start`);
  const result = await runAndPersistDealAnalysis(dealId, userId);
  console.log(`[deals/analyze/${dealId}] dev inline run done: ok=${result.ok}${result.error ? ` error=${result.error}` : ""}`);
  return { inlineDone: result.ok, inlineError: result.error };
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { dealId, force } = (await req.json().catch(() => ({}))) as { dealId?: string; force?: boolean };
  if (!dealId) return NextResponse.json({ error: "dealId manquant" }, { status: 400 });

  const existing = await fetchRow(dealId);
  const updatedMs = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
  const ageMs = updatedMs ? Date.now() - updatedMs : Infinity;

  // Si l'analyse est fraîche (<24h) et qu'on ne force pas, on la renvoie direct.
  if (!force && existing?.status === "done" && ageMs < FRESH_TTL_MS) {
    return NextResponse.json({
      ok: true,
      cached: true,
      ...shape(existing),
    });
  }

  // Si une analyse tourne déjà depuis moins de 10 min, on ne relance pas
  // (sauf si l'utilisateur force, ex. bouton "Relancer" sur une analyse
  // stuck).
  if (!force && existing?.status === "analyzing" && ageMs < 10 * 60 * 1000) {
    return NextResponse.json({
      ok: true,
      queued: true,
      ...shape(existing),
    });
  }

  // Upsert pending puis trigger BG. La ligne existe peut-être déjà -> upsert
  // sur la contrainte UNIQUE(deal_id).
  const nowIso = new Date().toISOString();
  const { error: upsertErr } = await db
    .from("deal_analyses")
    .upsert(
      {
        deal_id: dealId,
        user_id: user.id,
        status: "analyzing",
        error_message: null,
        updated_at: nowIso,
      },
      { onConflict: "deal_id" },
    );
  if (upsertErr) {
    console.error(`[deals/analyze/${dealId}] upsert failed:`, upsertErr.message);
    return NextResponse.json({ error: `Persistance impossible: ${upsertErr.message}` }, { status: 500 });
  }

  const trigger = await triggerBackground(req, dealId, user.id);

  // En dev on a awaité la run inline : si elle est done, on renvoie l'analyse
  // tout de suite et le client n'a pas à poller.
  if (trigger.inlineDone) {
    const fresh = await fetchRow(dealId);
    if (fresh?.status === "done") {
      return NextResponse.json({ ok: true, cached: false, ...shape(fresh) });
    }
  }
  if (trigger.inlineError) {
    return NextResponse.json({ error: trigger.inlineError }, { status: 500 });
  }

  // On renvoie l'ancienne analyse si elle existe (stale-while-revalidate côté UI)
  // et l'état `analyzing` pour que le client commence à poller.
  return NextResponse.json({
    ok: true,
    queued: true,
    status: "analyzing",
    analysis: existing?.status === "done" ? existing.analysis : null,
    stale: existing?.status === "done" ? true : false,
    updatedAt: existing?.updated_at ?? nowIso,
    error: null,
  });
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const dealId = req.nextUrl.searchParams.get("dealId");
  if (!dealId) return NextResponse.json({ error: "dealId manquant" }, { status: 400 });

  const row = await fetchRow(dealId);
  if (!row) {
    return NextResponse.json({ ok: true, status: "none", analysis: null, updatedAt: null, error: null });
  }

  const ageMs = row.updated_at ? Date.now() - new Date(row.updated_at).getTime() : Infinity;
  return NextResponse.json({
    ok: true,
    ...shape(row),
    stale: row.status === "done" && ageMs >= STALE_RERUN_TTL_MS,
  });
}

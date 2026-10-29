import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runAndPersistLossAnalysis } from "@/lib/deals/run-loss-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Analyse de perte d'un deal closed lost. Jamais automatique : POST au clic
// sur "Analyze the loss" (ou "Reanalyze"), GET pour relire / poller la ligne.

type LossRow = {
  status: string;
  analysis: unknown;
  error_message: string | null;
  updated_at: string;
  hubspot_reason_written_at: string | null;
  reopen_task_created_at: string | null;
};

const SELECT = "status, analysis, error_message, updated_at, hubspot_reason_written_at, reopen_task_created_at";

// Table absente = migration supabase/migrations/deal_loss_analyses.sql pas
// appliquée : on le dit plutôt que d'afficher un état vide trompeur.
function tableError(message: string, code?: string): string {
  return code === "42P01" || /deal_loss_analyses/.test(message)
    ? "The deal_loss_analyses table is missing: apply supabase/migrations/deal_loss_analyses.sql in Supabase."
    : message;
}

function shape(row: LossRow | null) {
  return {
    status: row?.status ?? "none",
    analysis: row?.analysis ?? null,
    updatedAt: row?.updated_at ?? null,
    error: row?.error_message ?? null,
    hubspotReasonWrittenAt: row?.hubspot_reason_written_at ?? null,
    reopenTaskCreatedAt: row?.reopen_task_created_at ?? null,
  };
}

async function fetchRow(dealId: string): Promise<{ row: LossRow | null; error: string | null }> {
  const { data, error } = await db.from("deal_loss_analyses").select(SELECT).eq("deal_id", dealId).maybeSingle();
  if (error) return { row: null, error: tableError(error.message, error.code) };
  return { row: (data as LossRow | null) ?? null, error: null };
}

async function triggerBackground(req: NextRequest, dealId: string, userId: string): Promise<{ inlineDone: boolean; inlineError?: string }> {
  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);
  const useBackground = isNetlifyEnv && process.env.NODE_ENV !== "development";

  if (useBackground) {
    const internalSecret = process.env.INTERNAL_SECRET;
    if (!internalSecret) return { inlineDone: false, inlineError: "INTERNAL_SECRET not configured" };
    try {
      const bgRes = await fetch(`${req.nextUrl.origin}/.netlify/functions/deals-loss-analyze-background`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
        body: JSON.stringify({ dealId, userId }),
        signal: AbortSignal.timeout(8000),
      });
      if (bgRes.status !== 202 && !bgRes.ok) {
        const text = await bgRes.text().catch(() => "");
        return { inlineDone: false, inlineError: `BG non-202 (${bgRes.status}): ${text.slice(0, 200)}` };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("aborted") && !msg.includes("timeout")) return { inlineDone: false, inlineError: msg };
    }
    return { inlineDone: false };
  }

  // Dev : on attend la fin (pas de timeout serverless en local), le client
  // reçoit directement le résultat au lieu de poller.
  const result = await runAndPersistLossAnalysis(dealId, userId);
  return { inlineDone: result.ok, inlineError: result.error };
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { dealId, force } = (await req.json().catch(() => ({}))) as { dealId?: string; force?: boolean };
  if (!dealId) return NextResponse.json({ error: "dealId missing" }, { status: 400 });

  const existing = await fetchRow(dealId);
  if (existing.error) return NextResponse.json({ error: existing.error }, { status: 500 });
  const row = existing.row;
  const ageMs = row?.updated_at ? Date.now() - new Date(row.updated_at).getTime() : Infinity;

  if (!force && row?.status === "done") return NextResponse.json({ ok: true, ...shape(row) });
  // Une analyse tourne déjà depuis moins de 10 min : on ne la double pas.
  if (!force && row?.status === "analyzing" && ageMs < 10 * 60 * 1000) {
    return NextResponse.json({ ok: true, ...shape(row) });
  }

  const { error: upsertErr } = await db.from("deal_loss_analyses").upsert(
    { deal_id: dealId, user_id: user.id, status: "analyzing", error_message: null, updated_at: new Date().toISOString() },
    { onConflict: "deal_id" },
  );
  if (upsertErr) {
    return NextResponse.json({ error: tableError(upsertErr.message, upsertErr.code) }, { status: 500 });
  }

  const trigger = await triggerBackground(req, dealId, user.id);
  if (trigger.inlineError) return NextResponse.json({ error: trigger.inlineError }, { status: 500 });

  const fresh = await fetchRow(dealId);
  // Pendant un re-run, l'ancienne analyse reste affichée (la colonne analysis
  // n'est remplacée qu'au status done).
  return NextResponse.json({ ok: true, ...shape(fresh.row), status: trigger.inlineDone ? "done" : "analyzing" });
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const dealId = req.nextUrl.searchParams.get("dealId");
  if (!dealId) return NextResponse.json({ error: "dealId missing" }, { status: 400 });

  const { row, error } = await fetchRow(dealId);
  if (error) return NextResponse.json({ ok: false, ...shape(null), status: "unavailable", error }, { status: 500 });
  return NextResponse.json({ ok: true, ...shape(row) });
}

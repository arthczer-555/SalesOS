import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runClientRefresh } from "@/lib/clients/run-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/clients/[id]/refresh
//
// Refresh incrémental (bouton "Actualiser") : prend en compte les nouvelles
// activités depuis le dernier passage, recalcule health + news et ré-extrait
// les fields qui ont changé, sans tout ré-analyser (pas de coach brief / deal
// recap). Ne touche pas enrichment_status.
//
// Action légère/CS : tout utilisateur authentifié (pas admin-only comme
// l'enrich complet). 409 si le client n'a pas encore été enrichi.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, enrichment_status")
    .eq("id", id)
    .single();
  if (clientErr || !client) {
    return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  }
  if (client.enrichment_status !== "done") {
    return NextResponse.json(
      { error: "Lance d'abord l'enrichissement complet avant d'actualiser." },
      { status: 409 },
    );
  }

  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);

  if (!isNetlifyEnv) {
    void runClientRefresh(id, user.id).catch((e) => {
      console.error(`[clients/refresh/${id}] inline run failed:`, e instanceof Error ? e.message : e);
    });
    return NextResponse.json({ ok: true, mode: "inline" }, { status: 202 });
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    return NextResponse.json({ error: "INTERNAL_SECRET manquant" }, { status: 500 });
  }

  const triggerUrl = `${req.nextUrl.origin}/.netlify/functions/clients-refresh-background`;
  try {
    const res = await fetch(triggerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ id, userId: user.id }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      console.error(`[clients/refresh/${id}] bg trigger ${res.status}:`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error(`[clients/refresh/${id}] bg trigger failed:`, msg);
    }
  }

  return NextResponse.json({ ok: true, mode: "background" }, { status: 202 });
}

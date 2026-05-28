import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runClientEnrichment } from "@/lib/clients/run-enrichment";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/clients/[id]/enrich
//
// Trigger manuel de l'enrichissement IA pour un client précis. Utilisé :
//  - en phase de test (CLIENTS_AUTO_ENRICH=false) pour lancer l'extraction
//    sur le deal qu'on a choisi sans dépendre du webhook,
//  - pour rejouer manuellement après une erreur (status=error).
//
// Admin-only en attendant qu'on définisse une politique plus fine. Le coût
// d'un enrichissement (~0,20 $) justifie de ne pas l'exposer à tout le monde.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  if (!userRow?.is_admin) {
    return NextResponse.json({ error: "Admin requis" }, { status: 403 });
  }

  const { id } = await params;

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, hubspot_deal_id, enrichment_status")
    .eq("id", id)
    .single();
  if (clientErr || !client) {
    return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  }

  // Si l'enrichissement est en cours, on ne relance pas (runClientEnrichment
  // a son propre garde-fou, mais on peut renvoyer un 409 explicite ici).
  if (client.enrichment_status === "running") {
    return NextResponse.json({ ok: true, already_running: true }, { status: 409 });
  }

  // Reset si on rejoue après done/error : passe en pending pour que
  // runClientEnrichment accepte de tourner (sinon il court-circuite sur done).
  if (client.enrichment_status === "done" || client.enrichment_status === "error") {
    await db
      .from("clients")
      .update({
        enrichment_status: "pending",
        enrichment_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  }

  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);

  if (!isNetlifyEnv) {
    // En dev : on lance en fire-and-forget dans le même process. La fiche
    // poll en SWR sur enrichment_status, donc l'utilisateur verra running
    // puis done sans qu'on bloque la réponse HTTP.
    void runClientEnrichment(id, user.id).catch((e) => {
      console.error(`[clients/enrich/${id}] inline run failed:`, e instanceof Error ? e.message : e);
    });
    return NextResponse.json({ ok: true, mode: "inline" }, { status: 202 });
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    return NextResponse.json({ error: "INTERNAL_SECRET manquant" }, { status: 500 });
  }

  // En prod : trigger la Netlify Background Function. La fiche poll en SWR.
  const triggerUrl = `${req.nextUrl.origin}/.netlify/functions/clients-enrich-background`;
  try {
    const res = await fetch(triggerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ id, userId: user.id }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      console.error(`[clients/enrich/${id}] bg trigger ${res.status}:`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error(`[clients/enrich/${id}] bg trigger failed:`, msg);
    }
  }

  return NextResponse.json({ ok: true, mode: "background" }, { status: 202 });
}

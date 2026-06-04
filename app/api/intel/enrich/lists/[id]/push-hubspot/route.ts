import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { triggerPushHubspot } from "@/lib/intel/trigger-push-hubspot";
import type { HubspotPushState, HubspotPushOptions } from "@/lib/intel-types";

export const dynamic = "force-dynamic";

const STALE_RUNNING_MS = 15 * 60_000;

// POST /api/intel/enrich/lists/[id]/push-hubspot
// Action optionnelle : crée les contacts de la liste dans HubSpot (dédup par
// email, association à une company existante). Options de l'enrich :
// { createMissingCompanies?, addToScopeOwner? }. Pose le statut "running" puis
// délègue à la Background Function (runtime long).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const body = (await req.json().catch(() => null)) as {
    createMissingCompanies?: boolean;
    addToScopeOwner?: string | null;
  } | null;
  const options: HubspotPushOptions = {
    createMissingCompanies: !!body?.createMissingCompanies,
    addToScopeOwner: body?.addToScopeOwner?.trim() || null,
  };

  const { data: row, error } = await db
    .from("enrichment_lists")
    .select("id, criteria, user_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (error || !row) return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });

  // Garde anti-double-lancement : un push récent encore "running" bloque, mais on
  // débloque au-delà de 15 min (run morte) pour ne pas geler le bouton à vie.
  const current = (row.criteria as { hubspotPush?: HubspotPushState } | null)?.hubspotPush;
  if (current?.status === "running") {
    const startedMs = current.startedAt ? Date.parse(current.startedAt) : 0;
    if (Date.now() - startedMs < STALE_RUNNING_MS) {
      return NextResponse.json({ error: "Un envoi est déjà en cours pour cette liste." }, { status: 409 });
    }
  }

  const startedAt = new Date().toISOString();
  const base = row.criteria && typeof row.criteria === "object" ? (row.criteria as Record<string, unknown>) : {};
  // On persiste aussi les options dans criteria.hubspotPush.options (durable +
  // fallback côté pushListToHubspot si le body de la background function saute).
  const running: HubspotPushState = { status: "running", startedAt, options };
  await db
    .from("enrichment_lists")
    .update({ criteria: { ...base, hubspotPush: running }, updated_at: startedAt })
    .eq("id", id);

  await triggerPushHubspot(id, user.id, req.nextUrl.origin, options);

  return NextResponse.json({ ok: true, status: "running" }, { status: 202 });
}

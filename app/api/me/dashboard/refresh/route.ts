// POST /api/me/dashboard/refresh — rafraîchit le snapshot du SEUL rep appelant.
//
// Le vrai temps réel est hors de portée : un snapshot rep, c'est plusieurs
// milliers de records HubSpot paginés, soit bien plus que le timeout d'une
// route. On fait donc du stale-while-revalidate : le dashboard affiche
// immédiatement le snapshot en base, appelle cette route, et SWR récupère la
// version fraîche quand le recalcul de fond a fini.
//
// Garde de fraîcheur : au-delà d'un refresh par rep et par MIN_AGE_MINUTES, on
// répond "fresh" sans rien déclencher. Sans elle, chaque rechargement de page
// relancerait un fetch HubSpot complet et un appel Claude.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { readUserSalesFields } from "@/lib/users/read-sales-roles";
import { runAeActivityRefresh } from "@/lib/ae-activity/build-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_AGE_MINUTES = 180;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { hubspotOwnerId: ownerId } = await readUserSalesFields(user.id);
  if (!ownerId) return NextResponse.json({ ok: false, reason: "no_owner" }, { status: 200 });

  const { data: snap } = await db
    .from("ae_activity_snapshots")
    .select("refreshed_at")
    .eq("rep_owner_id", ownerId)
    .maybeSingle();

  const refreshedAt = (snap?.refreshed_at as string | undefined) ?? null;
  if (refreshedAt) {
    const ageMinutes = (Date.now() - new Date(refreshedAt).getTime()) / 60_000;
    if (ageMinutes < MIN_AGE_MINUTES) {
      return NextResponse.json({ ok: true, triggered: false, reason: "fresh", refreshedAt });
    }
  }

  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);
  if (!isNetlifyEnv) {
    void runAeActivityRefresh({ ownerIds: [ownerId] }).catch((e) =>
      console.error("[me/dashboard/refresh] inline run failed:", e instanceof Error ? e.message : e),
    );
    return NextResponse.json({ ok: true, triggered: true, mode: "inline" }, { status: 202 });
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    return NextResponse.json({ error: "INTERNAL_SECRET missing" }, { status: 500 });
  }

  try {
    const res = await fetch(`${req.nextUrl.origin}/.netlify/functions/ae-activity-refresh-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ trigger: "dashboard", ownerIds: [ownerId] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      console.error(`[me/dashboard/refresh] bg trigger ${res.status}:`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[me/dashboard/refresh] bg trigger failed:", msg);
    }
  }

  return NextResponse.json({ ok: true, triggered: true, mode: "background" }, { status: 202 });
}

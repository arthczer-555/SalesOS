import { NextRequest, NextResponse, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { startBriefRun } from "@/lib/watchlist/briefs";
import { runHubspotRecap } from "@/lib/watchlist/fetch-company-recap";

export const dynamic = "force-dynamic";

export interface RefreshHubspotRecapResponse {
  ok: boolean;
  queued?: boolean;
  alreadyRunning?: boolean;
  briefId?: string;
  error?: string;
}

const BG_FN = "watchlist-hubspot-recap-background";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;

  const { data: company, error: companyErr } = await db
    .from("scope_companies")
    .select("id, name")
    .eq("id", id)
    .single();
  if (companyErr || !company) {
    return NextResponse.json({ ok: false, error: "Compte introuvable" }, { status: 404 });
  }

  const { alreadyRunning, briefId } = await startBriefRun({
    scopeCompanyId: id,
    kind: "hubspot_recap",
    userId: user.id,
  });
  if (alreadyRunning) {
    return NextResponse.json({ ok: true, alreadyRunning: true, briefId });
  }

  const startedAt = new Date().toISOString();
  const siteUrl = process.env.URL ?? process.env.SITE_URL ?? req.nextUrl.origin;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NETLIFY === "true" && cronSecret) {
    // Prod Netlify : fire-and-forget vers la BG fn
    fetch(`${siteUrl}/.netlify/functions/${BG_FN}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ scopeCompanyId: id, userId: user.id, briefId, startedAt }),
    }).catch((e) => {
      console.error(`[briefs/hubspot-recap] background invoke failed:`, e);
    });
    return NextResponse.json({ ok: true, queued: true, briefId }, { status: 202 });
  }

  // Dev local : after() exécute la même logique après la réponse
  after(async () => {
    const res = await runHubspotRecap({ scopeCompanyId: id });
    if (!res.ok) {
      console.error("[briefs/hubspot-recap] dev run failed:", res.error);
    }
  });

  return NextResponse.json({ ok: true, queued: true, briefId }, { status: 202 });
}

import { NextRequest, NextResponse, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { startBriefRun, type AeTarget } from "@/lib/watchlist/briefs";
import { runAeAnalysis } from "@/lib/watchlist/run-ae-analysis";

export const dynamic = "force-dynamic";

export interface RefreshAeAnalysisResponse {
  ok: boolean;
  queued?: boolean;
  alreadyRunning?: boolean;
  briefId?: string;
  error?: string;
}

const BG_FN = "watchlist-ae-analysis-background";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  // withMessages=false : analyse seule (qui contacter + pourquoi), sans rédiger
  // de message d'ouverture. Défaut true (régénération complète).
  const body = await req.json().catch(() => ({}));
  const withMessages = (body as { withMessages?: boolean })?.withMessages !== false;
  // Contacts pré-sélectionnés (popup "Analysis + messages") : restreint les
  // opening messages à ces prospects. Normalisés/bornés pour ne pas faire
  // exploser le prompt et ignorer un payload malformé.
  const rawTargets = (body as { targets?: unknown })?.targets;
  const targets: AeTarget[] = Array.isArray(rawTargets)
    ? rawTargets
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .map((t) => ({
          name: typeof t.name === "string" ? t.name : "",
          role: typeof t.role === "string" ? t.role : null,
          email: typeof t.email === "string" ? t.email : null,
          hubspot_id: typeof t.hubspot_id === "string" ? t.hubspot_id : null,
        }))
        .filter((t) => t.name || t.email)
        .slice(0, 25)
    : [];

  const { data: company, error: companyErr } = await db
    .from("scope_companies")
    .select("id")
    .eq("id", id)
    .single();
  if (companyErr || !company) {
    return NextResponse.json({ ok: false, error: "Account not found" }, { status: 404 });
  }

  const { alreadyRunning, briefId } = await startBriefRun({
    scopeCompanyId: id,
    kind: "ae_analysis",
    userId: user.id,
  });
  if (alreadyRunning) {
    return NextResponse.json({ ok: true, alreadyRunning: true, briefId });
  }

  const startedAt = new Date().toISOString();
  const siteUrl = process.env.URL ?? process.env.SITE_URL ?? req.nextUrl.origin;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NETLIFY === "true" && cronSecret) {
    fetch(`${siteUrl}/.netlify/functions/${BG_FN}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ scopeCompanyId: id, userId: user.id, briefId, startedAt, withMessages, targets }),
    }).catch((e) => {
      console.error(`[briefs/ae-analysis] background invoke failed:`, e);
    });
    return NextResponse.json({ ok: true, queued: true, briefId }, { status: 202 });
  }

  after(async () => {
    const res = await runAeAnalysis({ scopeCompanyId: id, userId: user.id, withMessages, targets });
    if (!res.ok) {
      console.error("[briefs/ae-analysis] dev run failed:", res.error);
    }
  });

  return NextResponse.json({ ok: true, queued: true, briefId }, { status: 202 });
}

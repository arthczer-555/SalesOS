import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { runProspectingTick } from "@/lib/prospecting/engine/tick";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BG_FN = "prospecting-tick-background";

// Déclenchement manuel du moteur (admin) :
// - dryRun : simulation inline (aucun envoi ni écriture), retourne le plan ;
// - sinon, sur Netlify : Background Function (une route sync serait coupée à ~26 s) ;
// - en dev : tick inline, résumé complet en réponse.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean; userId?: string };
  const dryRun = body.dryRun === true;
  const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : undefined;
  const onNetlify = process.env.NETLIFY === "true";

  if (onNetlify && !dryRun) {
    const cronSecret = process.env.CRON_SECRET;
    const siteUrl = process.env.URL ?? process.env.SITE_URL ?? req.nextUrl.origin;
    if (!cronSecret) {
      return NextResponse.json({ error: "Tick unavailable: CRON_SECRET is not configured." }, { status: 503 });
    }
    try {
      const res = await fetch(`${siteUrl}/.netlify/functions/${BG_FN}`, {
        method: "POST",
        headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
        body: JSON.stringify({ userId }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok && res.status !== 202) {
        return NextResponse.json({ error: `Could not start the tick (HTTP ${res.status}).` }, { status: 502 });
      }
    } catch (e) {
      return NextResponse.json({ error: `Could not start the tick: ${errMessage(e)}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, queued: true }, { status: 202 });
  }

  try {
    const summary = await runProspectingTick({
      dryRun,
      userId,
      origin: req.nextUrl.origin,
      // Netlify (dryRun seulement) : rester sous la limite des routes sync.
      deadlineMs: onNetlify ? 20_000 : 4 * 60_000,
    });
    return NextResponse.json({ ok: true, queued: false, summary });
  } catch (e) {
    return NextResponse.json({ error: `Tick failed: ${errMessage(e)}` }, { status: 500 });
  }
}

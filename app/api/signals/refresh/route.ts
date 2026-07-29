import { NextRequest, NextResponse, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { runSignalsSweep, type SweepOptions } from "@/lib/signals/run-sweep";

export const dynamic = "force-dynamic";

const BG_FN = "signals-sweep-background";

export interface RefreshSignalsResponse {
  ok: boolean;
  queued?: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { onlyQueries?: string[] };

  // Le refresh manuel fait exactement le même travail que le cron : depuis la
  // refonte, le sweep n'a plus de sources lentes à écarter.
  const opts: SweepOptions = {
    onlyQueries: Array.isArray(body.onlyQueries) ? body.onlyQueries : null,
    userId: user.id,
  };

  const siteUrl = process.env.URL ?? process.env.SITE_URL ?? req.nextUrl.origin;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NETLIFY === "true") {
    // En prod, le sweep DOIT passer par la Background Function : `after()` tourne
    // dans la fonction sync (limite plan ~26 s) et serait tué en plein sweep,
    // travail perdu silencieusement. Sans CRON_SECRET, échouer explicitement.
    if (!cronSecret) {
      return NextResponse.json(
        { ok: false, error: "Refresh unavailable: CRON_SECRET is not configured." },
        { status: 503 },
      );
    }
    fetch(`${siteUrl}/.netlify/functions/${BG_FN}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify(opts),
    }).catch((e) => console.error("[signals/refresh] background invoke failed:", e));
    return NextResponse.json({ ok: true, queued: true }, { status: 202 });
  }

  // Dev local uniquement : exécution in-process après la réponse.
  after(async () => {
    const res = await runSignalsSweep(opts);
    if (!res.ok) console.error("[signals/refresh] dev run failed:", res.error);
  });
  return NextResponse.json({ ok: true, queued: true }, { status: 202 });
}

import type { Context } from "@netlify/functions";
import { runSignalsSweep, type SweepOptions } from "../../lib/signals/run-sweep";

// Background function : sweep complet du pipeline Signals (scan marché global +
// classify Claude + dédup + recherche d'un lead joignable pour chaque signal +
// persist + rétention). Dure typiquement 8-11 min : runtime Background ~15 min.
//
// Auth : Bearer CRON_SECRET (posé par le cron planifié ou /api/signals/refresh).
// Body : SweepOptions ({ userId?, dryRun?, onlyQueries? })
export default async (req: Request, _ctx: Context) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: SweepOptions = {};
  try {
    body = (await req.json()) as SweepOptions;
  } catch {
    body = {};
  }

  try {
    const res = await runSignalsSweep(body);
    if (!res.ok) console.error("[signals-sweep-background] failed:", res.error);
    else console.log("[signals-sweep-background] done:", JSON.stringify(res));
  } catch (e) {
    console.error("[signals-sweep-background] unexpected:", e);
  }

  return new Response(null, { status: 200 });
};

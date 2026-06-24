// Déclenchement uniforme d'un job background (orgchart + Apollo). Remplace cinq
// copies de "fetch fire-and-forget non awaité" qui laissaient le job bloqué en
// `running` à vie si l'invocation échouait (réseau, fonction non déployée, 401
// CRON_SECRET, ou CRON_SECRET absent en prod -> fallback after() synchrone ~26s).
//
// On AWAITE l'invocation de la Background Function (qui répond 202 instantanément,
// donc rapide) et, en cas d'échec, on marque le job en `error` AVANT que la route
// ne réponde. En dev/non-Netlify, on exécute le runner via after() (le runner
// marque lui-même le job en erreur le cas échéant). cf. B10.
import { after } from "next/server";
import { db } from "@/lib/db";

interface DispatchOpts {
  jobId: string;
  fnName: string; // nom de la Netlify Background Function (.netlify/functions/<fnName>)
  table: "orgchart_import_jobs" | "apollo_enrichment_jobs";
  origin: string; // repli si URL/SITE_URL absents (req.nextUrl.origin)
  run: () => Promise<{ ok: boolean; error?: string }>; // runner in-process (dev)
}

async function markJobError(table: DispatchOpts["table"], jobId: string, message: string): Promise<void> {
  await db
    .from(table)
    .update({ status: "error", error: message, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .then(undefined, () => {});
}

export async function triggerBackgroundJob({ jobId, fnName, table, origin, run }: DispatchOpts): Promise<void> {
  const cronSecret = process.env.CRON_SECRET;
  const siteUrl = process.env.URL ?? process.env.SITE_URL ?? origin;

  if (process.env.NETLIFY === "true") {
    if (!cronSecret) {
      // Pas de fallback after() synchrone en prod (timeout ~26s sur gros comptes).
      await markJobError(table, jobId, "CRON_SECRET missing: background dispatch unavailable");
      return;
    }
    try {
      const res = await fetch(`${siteUrl}/.netlify/functions/${fnName}`, {
        method: "POST",
        headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) throw new Error(`background invoke HTTP ${res.status}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "background invoke failed";
      console.error(`[orgchart] background invoke failed (${fnName}):`, message);
      await markJobError(table, jobId, message);
    }
    return;
  }

  // Dev / non-Netlify : exécution in-process après la réponse. Le runner gère
  // lui-même la mise en erreur du job ; on se contente de logguer.
  after(async () => {
    const r = await run();
    if (!r.ok) console.error(`[orgchart] dev run failed (${fnName}):`, r.error);
  });
}

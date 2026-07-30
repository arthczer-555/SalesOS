import { runAeActivityRefresh } from "../../lib/ae-activity/build-snapshot";

// Background function : recalcule le snapshot AE. Déclenchée soit par la route
// admin "Refresh" (x-internal-secret), soit par le cron quotidien
// ae-activity-refresh-scheduled (Bearer CRON_SECRET), soit par le dashboard
// d'un rep dont le snapshot est périmé (x-internal-secret + ownerIds).
//
// `ownerIds` limite le recalcul à ces reps : un rep qui ouvre son dashboard ne
// doit pas relancer le fetch HubSpot de toute l'équipe.
export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const internalOk = !!internalSecret && req.headers.get("x-internal-secret") === internalSecret;
  const cronOk = !!cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`;
  if (!internalOk && !cronOk) {
    console.error("[ae-activity-refresh-bg] unauthorized");
    return;
  }

  let ownerIds: string[] = [];
  try {
    const body = (await req.json()) as { ownerIds?: unknown };
    if (Array.isArray(body.ownerIds)) {
      ownerIds = body.ownerIds.filter((id): id is string => typeof id === "string" && id.length > 0);
    }
  } catch {
    // Body absent ou illisible : refresh complet, comportement historique.
  }

  const scope = ownerIds.length > 0 ? `${ownerIds.length} rep(s)` : "all reps";
  const result = await runAeActivityRefresh({ ownerIds });
  if (!result.ok) {
    console.error(`[ae-activity-refresh-bg] failed (${scope}):`, result.error);
  } else {
    console.log(`[ae-activity-refresh-bg] done (${scope}): ${result.repCount} reps`);
  }
};

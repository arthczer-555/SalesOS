import { prepareMeetingConfirmation } from "../../lib/clients/prepare-meetings";

// Background Function : découverte des meetings Claap d'un nouveau client +
// passage en 'awaiting_meetings' + DM Slack à l'AE. Sortie du chemin synchrone
// (webhook / backfill) car le scan Claap peut dépasser le timeout d'une
// fonction sync Netlify. Calquée sur clients-enrich-background.mts.
export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[clients-prepare-meetings-bg] unauthorized");
    return;
  }

  let id: string | undefined;
  try {
    const body = (await req.json()) as { id?: string };
    id = body.id;
  } catch {
    console.error("[clients-prepare-meetings-bg] invalid JSON body");
    return;
  }

  if (!id) {
    console.error("[clients-prepare-meetings-bg] missing id");
    return;
  }

  const result = await prepareMeetingConfirmation(id);
  if (!result.ok) {
    console.error(`[clients-prepare-meetings-bg] ${id} failed:`, result.error);
  } else if (result.alreadyPrepared) {
    console.log(`[clients-prepare-meetings-bg] ${id} already prepared/processed, skipped`);
  } else {
    console.log(`[clients-prepare-meetings-bg] ${id} ready : ${result.candidates} candidate(s)`);
  }
};

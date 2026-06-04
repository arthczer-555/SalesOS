import { pushListToHubspot } from "../../lib/intel/push-list-to-hubspot";
import type { HubspotPushOptions } from "../../lib/intel-types";

// Background Function : crée les contacts d'une liste dans HubSpot (dédup email,
// association à une company existante, et selon les options de l'enrich :
// création des companies manquantes + ajout au scope/sales). Sortie du chemin
// synchrone car 3-4 appels HubSpot par contact dépassent vite le timeout d'une
// fonction sync Netlify. Calquée sur clients-prepare-meetings-background.mts.
export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[lists-push-hubspot-bg] unauthorized");
    return;
  }

  let id: string | undefined;
  let userId: string | undefined;
  let options: HubspotPushOptions | undefined;
  try {
    const body = (await req.json()) as { id?: string; userId?: string; options?: HubspotPushOptions };
    id = body.id;
    userId = body.userId;
    options = body.options;
  } catch {
    console.error("[lists-push-hubspot-bg] invalid JSON body");
    return;
  }

  if (!id || !userId) {
    console.error("[lists-push-hubspot-bg] missing id/userId");
    return;
  }

  const state = await pushListToHubspot(id, userId, options);
  if (state.status === "error") {
    console.error(`[lists-push-hubspot-bg] ${id} failed:`, state.error);
  } else {
    const s = state.summary;
    console.log(
      `[lists-push-hubspot-bg] ${id} done : ${s?.created ?? 0} créés, ${s?.existing ?? 0} existants, ` +
        `${s?.skippedNoEmail ?? 0} sans email, ${s?.companyAssociated ?? 0} associés, ` +
        `${s?.companyCreated ?? 0} companies créées, ${s?.scopeUpserted ?? 0} ajoutées au scope, ` +
        `${s?.errors ?? 0} erreurs`,
    );
  }
};

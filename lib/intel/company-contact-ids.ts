import { hubspotGetAssociations } from "@/lib/hubspot";
import { resolveHubspotCompanyId } from "@/lib/watchlist/resolve-hubspot-company";

// Résout une sélection de companies de la watchlist (ids scope_companies) vers
// l'ensemble des ids de contacts HubSpot qui leur sont *associés*.
//
// On s'appuie sur la même logique que la fiche company (associations HubSpot
// company→contacts, cf. lib/watchlist/fetch-company-contacts) et NON sur la
// propriété texte `company` du contact : ce champ est souvent vide ou différent
// même quand le contact est bien rattaché à la company, ce qui faisait remonter
// 0 contact dans le filtre alors que la fiche en affichait. Renvoie l'union des
// contacts de toutes les companies sélectionnées.
export async function resolveWatchlistCompanyContactIds(
  scopeCompanyIds: string[],
): Promise<Set<string>> {
  const ids = new Set<string>();
  await Promise.all(
    scopeCompanyIds.map(async (scopeId) => {
      try {
        const { hubspot_company_id } = await resolveHubspotCompanyId(scopeId);
        if (!hubspot_company_id) return;
        const assoc = await hubspotGetAssociations("companies", hubspot_company_id, "contacts");
        for (const a of assoc) if (a.id) ids.add(a.id);
      } catch {
        // Company non résolue / sans contacts associés : on l'ignore.
      }
    }),
  );
  return ids;
}

import { hubspotFetch } from "@/lib/hubspot";
import { HUBSPOT_CHECKLIST_FIELDS, type HubspotDealFields } from "./types";
import type { DealContractInfo } from "./portfolio";

type BatchReadResp = { results?: Array<{ id: string; properties?: Record<string, string | null> }> };

// Vue portefeuille : fin de contrat de plusieurs deals en un appel
// batch (100 ids max par appel). Échec = { ok: false } avec le message, jamais
// une map vide qui se lirait comme "aucune date".
export async function fetchDealsContractInfo(
  dealIds: string[],
): Promise<{ ok: true; deals: Map<string, DealContractInfo> } | { ok: false; error: string }> {
  const ids = [...new Set(dealIds.filter(Boolean))];
  const deals = new Map<string, DealContractInfo>();
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const resp = await hubspotFetch<BatchReadResp>("/crm/v3/objects/deals/batch/read", "POST", {
        properties: ["contract_end_date"],
        inputs: ids.slice(i, i + 100).map((id) => ({ id })),
      });
      for (const r of resp.results ?? []) {
        deals.set(r.id, { contractEnd: r.properties?.contract_end_date || null });
      }
    }
    return { ok: true, deals };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Lit les valeurs courantes des champs de qualification surveilles
// (HUBSPOT_CHECKLIST_FIELDS) sur un deal HubSpot. Best-effort : renvoie null si
// l'appel echoue (HubSpot KO, deal introuvable) pour ne jamais bloquer la fiche.
export async function fetchHubspotDealFields(dealId: string): Promise<HubspotDealFields | null> {
  if (!dealId) return null;
  const props = HUBSPOT_CHECKLIST_FIELDS.map((f) => f.property).join(",");
  try {
    const deal = await hubspotFetch<{ properties?: Record<string, string | null> }>(
      `/crm/v3/objects/deals/${dealId}?properties=${props}`,
    );
    const p = deal.properties ?? {};
    const out: HubspotDealFields = {};
    for (const f of HUBSPOT_CHECKLIST_FIELDS) {
      const v = p[f.property];
      out[f.property] = v == null || v === "" ? null : String(v);
    }
    return out;
  } catch {
    return null;
  }
}

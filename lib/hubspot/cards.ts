// Lecture légère des cartes (deals) HubSpot, partagée par le Lead Manager, le
// rapprochement Sales Coach et le flux #1y-new-meetings.
//
// Les cartes d'un contact sont lues par les associations (v4), jamais par la
// recherche : l'index de recherche HubSpot a du retard sur une carte qui vient
// d'être créée.

import { hubspotFetch } from "@/lib/hubspot";
import { isClosedStage, isSalesMotionPipeline } from "./pipeline-model";

export interface DealLite {
  id: string;
  dealname: string;
  pipeline: string;
  dealstage: string;
  wonFlag: boolean;
  lastModified: string;
}

/** Lecture groupée (100 au plus, plafond de l'API batch). */
export async function readDealsLite(ids: string[]): Promise<DealLite[]> {
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) return [];
  const res = await hubspotFetch<{ results?: { id: string; properties: Record<string, string | null> }[] }>(
    "/crm/v3/objects/deals/batch/read",
    "POST",
    { inputs: unique.map((id) => ({ id })), properties: ["dealname", "pipeline", "dealstage", "hs_is_closed_won", "hs_lastmodifieddate"] },
  );
  return (res.results ?? []).map((d) => ({
    id: String(d.id),
    dealname: d.properties.dealname ?? "",
    pipeline: d.properties.pipeline ?? "",
    dealstage: d.properties.dealstage ?? "",
    wonFlag: d.properties.hs_is_closed_won === "true",
    lastModified: d.properties.hs_lastmodifieddate ?? "",
  }));
}

/** Carte ouverte d'un pipeline de vente (Prospection ou Sales). */
export const isOpenSalesMotion = (d: DealLite) => isSalesMotionPipeline(d.pipeline) && !isClosedStage(d.dealstage);

/** Plus récemment modifiée d'abord. */
export const byRecent = (a: DealLite, b: DealLite) => b.lastModified.localeCompare(a.lastModified);

/** Identifiants des cartes associées à un contact (toutes, ouvertes ou non). */
export async function dealIdsOfContact(contactId: string): Promise<string[]> {
  const res = await hubspotFetch<{ results?: { toObjectId: string | number }[] }>(
    `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/deals?limit=100`,
  );
  return (res.results ?? []).map((r) => String(r.toObjectId));
}

/** Cartes ouvertes (Prospection ou Sales) d'un contact, la plus récente d'abord. */
export async function openCardsOfContact(contactId: string): Promise<DealLite[]> {
  const deals = await readDealsLite(await dealIdsOfContact(contactId));
  return deals.filter(isOpenSalesMotion).sort(byRecent);
}

/** Cartes ouvertes (Prospection ou Sales) d'une entreprise, la plus récente d'abord. */
export async function openCardsOfCompany(companyId: string): Promise<DealLite[]> {
  const res = await hubspotFetch<{ results?: { toObjectId: string | number }[] }>(
    `/crm/v4/objects/companies/${encodeURIComponent(companyId)}/associations/deals?limit=100`,
  );
  const deals = await readDealsLite((res.results ?? []).map((r) => String(r.toObjectId)));
  return deals.filter(isOpenSalesMotion).sort(byRecent);
}

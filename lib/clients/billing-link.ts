import {
  fetchBillingRows,
  matchBillingRow,
  matchLinkedBillingRows,
  normalizeCompany,
  type BillingRow,
} from "../billing/google-sheet";
import { DEAL_NAME_NOISE_TOKENS, tokenizeWords } from "./claap-discovery";
import type { Billing, ClientRow } from "./types";

// Quelles lignes du sheet revenue (onglet Historique) appartiennent à une fiche
// client. Deux modes :
//  - automatique : match par nom (nom de la fiche ou de la company HubSpot, plus
//    ceux des fiches absorbées par une fusion, cf. merge.ts) ;
//  - manuel : quand le nom HubSpot ne ressemble pas à celui du sheet ("Groupe
//    Engie" vs "ENGIE SA"), l'AM/CS relie la ou les lignes depuis la carte
//    Billing (route /api/clients/[id]/billing-link). Stocké dans
//    clients.billing_sheet_rows (migration clients_billing_link.sql), il
//    remplace le match par nom partout : enrichissement, refresh, Reload, cron
//    hebdo, fusion. Il sert aussi à corriger un match automatique faux (repli
//    par préfixe trop large).

type BillingTarget = Pick<ClientRow, "company_name" | "merged_clients" | "billing_sheet_rows">;

// Réponse du GET /api/clients/[id]/billing-link (sélecteur de lignes).
export type SheetRowOption = {
  company: string; // valeur exacte de la colonne Company
  total: number | null;
  current_year: number | null;
  is_rfp: boolean;
  suggested: boolean; // ressemble au nom de la fiche (looksLikeSheetRow)
  used_by: Array<{ id: string; company_name: string }>; // autres fiches qui lisent déjà la ligne
};
export type BillingLinkResponse = {
  rows: SheetRowOption[];
  // Lignes reliées à la main (null = match automatique par nom).
  linked: string[] | null;
  // Lignes lues aujourd'hui par la fiche (reliées ou trouvées par nom).
  current: string[];
  year: string;
};

// Noms sous lesquels chercher le compte dans le sheet revenue : le nom principal
// (celui de la fiche, ou de la company HubSpot au refresh) + ceux des fiches
// absorbées.
export function billingNamesOf(row: Pick<ClientRow, "company_name" | "merged_clients">, primaryName?: string): string[] {
  const names = [primaryName || row.company_name, ...(row.merged_clients ?? []).map((m) => m.company_name)];
  return [...new Set(names.map((n) => n?.trim()).filter((n): n is string => !!n))];
}

export function linkedBillingRowsOf(row: Pick<ClientRow, "billing_sheet_rows">): string[] {
  return (row.billing_sheet_rows ?? []).map((r) => r.trim()).filter(Boolean);
}

// Billing d'une fiche : lignes reliées à la main s'il y en a, sinon match par nom.
export function matchClientBilling(rows: BillingRow[], row: BillingTarget, primaryName?: string): Billing {
  const linked = linkedBillingRowsOf(row);
  return linked.length > 0 ? matchLinkedBillingRows(rows, linked) : matchBillingRow(rows, billingNamesOf(row, primaryName));
}

// Download + match pour une fiche (enrichissement, refresh). null si le sheet est
// illisible ou vide : l'appelant garde le billing connu au lieu de l'écraser par
// un "absent du sheet".
export async function getClientBilling(row: BillingTarget, primaryName?: string): Promise<Billing | null> {
  try {
    const rows = await fetchBillingRows();
    return rows.length > 0 ? matchClientBilling(rows, row, primaryName) : null;
  } catch (e) {
    console.warn(`[billing] sheet read failed for "${row.company_name}":`, e instanceof Error ? e.message : e);
    return null;
  }
}

// Lignes retenues par un billing stocké. Les billings calculés avant le lien
// manuel n'ont pas matched_rows : on retombe sur match_key ("A + B").
export function billingRowsOf(billing: Billing | null | undefined): string[] {
  if (!billing?.matched) return [];
  return billing.matched_rows ?? (billing.match_key ? billing.match_key.split(" + ") : []);
}

// Lien manuel du compte fusionné (cf. merge.ts). null si aucune des deux fiches
// n'en a : le match par nom continue, sur tous les noms. Sinon union des lignes
// de chaque fiche : ses lignes reliées, ou à défaut celles que ses noms trouvent
// dans le sheet (son billing stocké si le sheet est illisible), pour qu'un lien
// manuel d'un côté ne fasse pas perdre les lignes trouvées par nom de l'autre.
export function mergedBillingLink(
  sheet: BillingRow[] | null,
  kept: BillingTarget & Pick<ClientRow, "billing">,
  absorbed: BillingTarget & Pick<ClientRow, "billing">,
): string[] | null {
  if (linkedBillingRowsOf(kept).length === 0 && linkedBillingRowsOf(absorbed).length === 0) return null;
  const rowsOf = (r: BillingTarget & Pick<ClientRow, "billing">): string[] => {
    const linked = linkedBillingRowsOf(r);
    if (linked.length > 0) return linked;
    if (sheet && sheet.length > 0) return matchBillingRow(sheet, billingNamesOf(r)).matched_rows ?? [];
    return billingRowsOf(r.billing);
  };
  const out = new Map<string, string>();
  for (const name of [...rowsOf(kept), ...rowsOf(absorbed)]) {
    const key = normalizeCompany(name);
    if (!out.has(key)) out.set(key, name);
  }
  return [...out.values()];
}

// Mots distinctifs d'un nom ("Groupe Engie - Renewal" -> ["engie"]).
function nameTokens(name: string): string[] {
  return tokenizeWords(name).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !DEAL_NAME_NOISE_TOKENS.has(w));
}

// Ligne du sheet qui ressemble à l'un des noms de la fiche : mise en tête du
// sélecteur de lignes. Indicatif seulement, c'est l'humain qui relie.
export function looksLikeSheetRow(names: readonly string[], company: string): boolean {
  const target = normalizeCompany(company);
  if (!target) return false;
  const tokens = new Set(nameTokens(company));
  return names.some((n) => {
    const norm = normalizeCompany(n);
    if (norm && (norm.startsWith(target) || target.startsWith(norm))) return true;
    return nameTokens(n).some((t) => tokens.has(t));
  });
}

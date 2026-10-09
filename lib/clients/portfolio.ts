import type { Billing, ClientFieldValue, Health, HealthLabel, HealthPhase, InsightAction, Insights } from "./types";
import { resolveContractEnd, type ContractEnd } from "./lifecycle";
import { toClientTier, type ClientTier } from "./tier";

// Vue portefeuille (/clients) : une ligne compacte par fiche client, calculée
// côté serveur pour ne pas envoyer les jsonb complets (health, insights) au
// navigateur. Logique pure, sans I/O.

export type PortfolioAction = Pick<InsightAction, "title" | "owner" | "due" | "priority">;

export type ClientPortfolioItem = {
  id: string;
  hubspot_deal_id: string;
  hubspot_company_id: string | null;
  company_name: string;
  owner_email: string | null;
  owner_name: string | null;
  am_email: string | null;
  am_name: string | null;
  cs_email: string | null;
  cs_name: string | null;
  closedwon_at: string;
  enrichment_status: "pending" | "awaiting_meetings" | "running" | "done" | "error";
  am_cs_notified_at: string | null;
  // Fin de contrat retenue (resolveContractEnd) : date HubSpot, sinon celle
  // trouvée dans les échanges. null = HubSpot non lu (cf. hubspotError de la réponse).
  contract_end: ContractEnd | null;
  // Facturé de l'année en cours (onglet "Historique" du sheet revenue).
  billed_current_year: number | null;
  // Facturé lifetime (colonne "Total" du même onglet).
  billed_lifetime: number | null;
  billing_matched: boolean;
  health: { score: number; label: HealthLabel; trend: Health["trend"] | null; phase: HealthPhase | null } | null;
  top_risk: string | null;
  // Dernier contact connu (engagement HubSpot ou meeting Claap), calculé avec
  // la santé : colonne Last touch de la vue avancée. null si santé pas calculée
  // ou aucune activité datée.
  last_contact: { at: string; source: "hubspot" | "claap" | null } | null;
  next_action: PortfolioAction | null;
  open_actions: number;
  next_billing_date: string | null;
  next_billing_set_by: string | null;
  next_billing_set_at: string | null;
  // Importance du compte fixée par l'équipe (cf. lib/clients/tier.ts).
  tier: ClientTier | null;
};

// Pas de montant : la liste affiche le facturé du sheet revenue, pas le deal HubSpot.
export type DealContractInfo = { contractEnd: string | null };

// Sous-ensemble des colonnes `clients` lues par la route de liste.
export type PortfolioSourceRow = {
  id: string;
  hubspot_deal_id: string;
  hubspot_company_id: string | null;
  company_name: string;
  owner_email: string | null;
  owner_name: string | null;
  am_email: string | null;
  am_name: string | null;
  cs_email: string | null;
  cs_name: string | null;
  closedwon_at: string;
  billing: Billing | null;
  health: Health | null;
  insights: Insights | null;
  enrichment_status: ClientPortfolioItem["enrichment_status"];
  am_cs_notified_at: string | null;
  // fields_json.planning.fin_contrat_le, lu seul (cf. route de liste).
  contract_end_field?: ClientFieldValue | null;
  next_billing_date?: string | null;
  next_billing_set_by?: string | null;
  next_billing_set_at?: string | null;
  tier?: number | null;
};

// Anciennes fiches : drivers en texte seul, sans points. Même heuristique que
// la carte santé de la fiche (health-hero.tsx).
const NEGATIVE_LABEL = /silence|no |only one|limited|risk/i;

// Le signal qui pèse le plus contre le score : "où est le risque" en un coup d'œil.
export function topRisk(health: Health | null): string | null {
  if (!health) return null;
  const detailed = health.breakdown?.length ? health.breakdown : health.drivers_detail;
  if (detailed?.length) {
    const worst = detailed
      .filter((d) => d.impact === "negative" && (d.points ?? -1) < 0)
      .sort((a, b) => (a.points ?? -1) - (b.points ?? -1))[0];
    return worst?.label ?? null;
  }
  return (health.drivers ?? []).find((l) => NEGATIVE_LABEL.test(l)) ?? null;
}

// Même ordre que la carte Next actions de la fiche (ordre de génération), pour
// que le "next step" de la liste soit la première action affichée sur la fiche.
export function openActions(insights: Insights | null): InsightAction[] {
  return (insights?.actions ?? []).filter((a) => !a.done_at);
}

export function toPortfolioItem(row: PortfolioSourceRow, deal: DealContractInfo | null): ClientPortfolioItem {
  const open = openActions(row.insights);
  const first = open[0];
  const h = row.health;
  return {
    id: row.id,
    hubspot_deal_id: row.hubspot_deal_id,
    hubspot_company_id: row.hubspot_company_id,
    company_name: row.company_name,
    owner_email: row.owner_email,
    owner_name: row.owner_name,
    am_email: row.am_email,
    am_name: row.am_name,
    cs_email: row.cs_email,
    cs_name: row.cs_name,
    closedwon_at: row.closedwon_at,
    enrichment_status: row.enrichment_status,
    am_cs_notified_at: row.am_cs_notified_at,
    contract_end: deal
      ? resolveContractEnd({ contractEndDate: deal.contractEnd, closedwonAt: row.closedwon_at, conversationsField: row.contract_end_field })
      : null,
    billed_current_year: row.billing?.matched ? row.billing.current_year_revenue ?? null : null,
    billed_lifetime: row.billing?.matched ? row.billing.total_contract_value ?? null : null,
    billing_matched: !!row.billing?.matched,
    health:
      h && typeof h.score === "number"
        ? { score: h.score, label: h.label, trend: h.trend ?? null, phase: h.phase ?? null }
        : null,
    top_risk: topRisk(h),
    last_contact: h?.last_contact_at ? { at: h.last_contact_at, source: h.last_contact_source ?? null } : null,
    next_action: first ? { title: first.title, owner: first.owner ?? null, due: first.due ?? null, priority: first.priority } : null,
    open_actions: open.length,
    next_billing_date: row.next_billing_date ?? null,
    next_billing_set_by: row.next_billing_set_by ?? null,
    next_billing_set_at: row.next_billing_set_at ?? null,
    tier: toClientTier(row.tier),
  };
}

/**
 * Outil KPIs finance agrégés de CoachelloAI. Complète get_billing_revenue
 * (par client) : ici, les indicateurs au niveau société (facturé vs target,
 * renew/new, trimestres, churn, panier moyen, LTV, revenue par type). Lu en
 * temps réel depuis le sheet revenue (onglets Dashboard + Revenue par Trimestre).
 * La règle "source de vérité = sheet revenue, jamais HubSpot" vit dans la
 * description, lue au moment où le modèle choisit son outil.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { fetchRevenueKpis } from "@/lib/billing/revenue-kpis-sheet";
import type { ToolModule } from "./types";

const defs: Anthropic.Tool[] = [
  {
    name: "get_revenue_kpis",
    description:
      "Source de vérité OFFICIELLE et UNIQUE pour les KPIs finance AGRÉGÉS de Coachello (niveau société, pas par client) : lit le sheet revenue (onglets Dashboard + Revenue par Trimestre) en temps réel. Renvoie : CA facturé 2026 vs target (+ %), split renew vs new, performance par trimestre (Q1-Q4), et les metrics pluriannuelles (revenue + YoY par année, nb de clients, panier moyen, RFP, churn, repeat, revenue par type Human/AI/Hybrid, revenue SaaS, LTV). Les pourcentages sont des fractions (0.406 = 40,6 %). Appelle CET outil pour toute question de KPI/perf finance GLOBALE ('CA vs objectif', 'churn', 'panier moyen', 'LTV', 'renew vs new', 'revenu par trimestre'). Pour le CA d'UN client précis, son historique ou un top clients, utilise plutôt get_billing_revenue. Ne déduis JAMAIS ces chiffres de HubSpot ; le sheet fait foi. CAC et LTV/CAC ne sont pas renseignés à la source (null) : ne les invente pas. Granularité la plus fine : le trimestre. Pour une semaine, un mois ou une plage de dates (ex : 'facturé la semaine dernière'), utilise get_invoices, qui donne le même total.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

const module_: ToolModule = {
  defs,
  handlers: {
    get_revenue_kpis: async (_input, ctx) => {
      try {
        ctx.onProgress("Reading revenue KPIs...");
        const kpis = await fetchRevenueKpis();
        if (!kpis.ok) {
          return "Sheet revenue (KPIs) indisponible ou format inattendu (vérifier AE_REVENUE_DRIVE_FILE_ID et les onglets Dashboard / Revenue par Trimestre).";
        }
        ctx.onSource({ kind: "billing", title: "Sheet revenue (Dashboard + trimestre)" });
        return JSON.stringify(kpis);
      } catch (e) {
        return `Erreur lecture KPIs revenue : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },
  },
};

export const revenueKpisTools = module_;

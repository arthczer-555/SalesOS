/**
 * Outil facturation/revenue de CoachelloGPT (extrait de l'ancien lib/chat/core.ts).
 * La règle "source de vérité = sheet revenue, jamais HubSpot" vit ICI, dans la
 * description, lue au moment exact où le modèle choisit son outil.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { fetchBillingRows, matchBillingRow } from "@/lib/billing/google-sheet";
import type { ToolModule } from "./types";

const defs: Anthropic.Tool[] = [
  {
    name: "get_billing_revenue",
    description:
      "Source de vérité OFFICIELLE et UNIQUE pour toute question de facturation et de chiffre d'affaires client : lit le sheet revenue (onglet Historique, fichier Drive dédié). Renvoie par société la valeur totale du contrat, le revenue par année, le flag RFP, et la croissance YoY. Ne déduis JAMAIS ces chiffres de HubSpot (un montant de deal n'est pas du CA facturé) ; en cas d'écart, le sheet fait foi. Passe 'company' (matching flou : 'Adyen' matche 'ADYEN N.V.') pour cibler une société ; sans 'company', renvoie TOUTES les sociétés (utile pour un top clients ou un total). Pour la SITUATION d'un client (contexte, programme, contacts, santé, 'où on en est avec X'), c'est get_client qui répond : n'appelle cet outil en complément que si la question porte sur l'argent, ou lors d'une ANALYSE de compte (point de compte, QBR, churn, upsell) où le poids financier fait partie de la réponse. Sur une question de détail client, ne l'appelle pas.",
    input_schema: {
      type: "object" as const,
      properties: {
        company: { type: "string", description: "Nom de la société/client à chercher dans le sheet revenue. Omets pour lister toutes les sociétés." },
      },
      required: [],
    },
  },
];

const module_: ToolModule = {
  defs,
  handlers: {
    get_billing_revenue: async (input, ctx) => {
      try {
        ctx.onProgress("Reading revenue sheet...");
        const rows = await fetchBillingRows();
        if (rows.length === 0) {
          return "Sheet revenue indisponible ou vide (vérifier BILLING_DRIVE_FILE_ID et l'onglet Historique).";
        }
        ctx.onSource({ kind: "billing", title: "Sheet revenue (onglet Historique)" });
        const company = (input.company as string | undefined)?.trim();
        if (company) {
          const match = matchBillingRow(rows, company);
          if (!match.matched) {
            return JSON.stringify({
              matched: false,
              message: `Aucune ligne revenue pour "${company}" dans le sheet.`,
              available_companies: rows.map((r) => r.company),
            });
          }
          return JSON.stringify(match);
        }
        return JSON.stringify({
          source: "sheet revenue (onglet Historique)",
          count: rows.length,
          rows: rows.map((r) => ({
            company: r.company,
            isRfp: r.isRfp,
            total: r.total,
            revenueByYear: r.revenueByYear,
          })),
        });
      } catch (e) {
        return `Erreur lecture sheet revenue : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },
  },
};

export const billingTools = module_;

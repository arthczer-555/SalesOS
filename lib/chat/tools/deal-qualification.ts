/**
 * get_deal_qualification : la qualification d'un deal telle que la fiche /deals
 * l'affiche (score /100, Next move, Path to close, KUNA, buying committee,
 * threading, récaps Claap). Même calcul que la fiche et que le brief du chat
 * coach (lib/deals/coach-brief.ts) : rien n'est recalculé ici.
 * Source agents : "hubspot" (lib/agents/tools.ts).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { buildDealCoachBrief } from "@/lib/deals/coach-brief";
import type { ToolModule } from "./types";

const defs: Anthropic.Tool[] = [
  {
    name: "get_deal_qualification",
    description:
      "Qualification d'un deal HubSpot telle que la page Deals de CoachelloHQ l'affiche : score /100 et ses points forts / faibles, Next move (action, échéance, étapes, pourquoi), Path to close (budget, date de décision, Economic Buyer, 3 contacts actifs), KUNA sur 10 dimensions (K connu, U inconnu, N bloquant, A supposé, avec preuve et action), buying committee, contacts actifs sur 30 jours, récaps des derniers meetings Claap. Ces informations viennent du scoring de CoachelloHQ, pas de propriétés HubSpot. Trouve d'abord l'id du deal avec search_deals ou get_deals.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal_id: { type: "string", description: "Id HubSpot du deal." },
      },
      required: ["deal_id"],
    },
  },
];

const handlers: ToolModule["handlers"] = {
  get_deal_qualification: async (input, ctx) => {
    const dealId = typeof input.deal_id === "string" ? input.deal_id.trim() : "";
    if (!/^\d+$/.test(dealId)) return JSON.stringify({ error: "deal_id doit être l'id HubSpot numérique du deal." });
    ctx.onProgress("Reading deal qualification…");
    try {
      return await buildDealCoachBrief(dealId, { withMethod: false });
    } catch (e) {
      return JSON.stringify({ error: `Qualification illisible : ${e instanceof Error ? e.message : "erreur"}` });
    }
  },
};

export const dealQualificationTools: ToolModule = { defs, handlers };

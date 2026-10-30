/**
 * get_team_pot : le pot d'équipe 2026 ("The Coachello Pot", page /pot).
 * Lit le dernier snapshot de la synchro horaire (lib/team-pot/), donc les
 * mêmes chiffres que la page et que les annonces #office-life : aucun
 * recalcul à part. Sans cet outil, un agent chercherait le pot dans le sheet
 * revenue où il n'existe pas (seule la règle de calcul l'y relie).
 *
 * Accès : donnée d'équipe, visible par tout utilisateur connecté comme la
 * page /pot (pas de filtre par rep). Source agents : "revenue".
 */

import type Anthropic from "@anthropic-ai/sdk";
import { readTeamPot } from "@/lib/team-pot/read";
import { potPace } from "@/lib/team-pot/compute";
import {
  POT_ACCEL_BONUS,
  POT_AI_MULTIPLIER,
  POT_BASELINE,
  POT_BONUS,
  POT_END_LEVEL,
  POT_GATE,
  POT_LAST_DAY,
  POT_LAUNCH_DAY,
  POT_MAX,
  POT_START,
  POT_STEP,
} from "@/lib/team-pot/config";
import type { ToolModule } from "./types";

const defs: Anthropic.Tool[] = [
  {
    name: "get_team_pot",
    description:
      "Pot d'équipe 2026 (\"The Coachello Pot\", page /pot de CoachelloHQ, annonces dans #office-life) : montant du pot, CA 2026 suivi, paliers de 50k atteints avec la facture qui a fait franchir chacun, prochain palier et reste à faire, factures comptées depuis le lancement (bonus AI Roleplay compris), rythme hebdo nécessaire pour 2,7M et 3,0M, jours restants. Règle : +1 000 € par palier de 50k de 2,2M à 2,7M, +2 000 € de 2,75M à 3,0M, une facture AI compte 1,5x sa part. Source : onglet Factures du sheet revenue (facturé New + Renew), mais SEULES les factures datées du 30/10 au 31/12/2026 font bouger le pot, au-dessus d'un point de départ figé (facturé 2026 avant le 30/10). Ce n'est donc pas forcément le facturé 2026 courant du sheet : pour lui, utilise get_revenue_kpis ou get_invoices. Chiffres rafraîchis toutes les heures de 8h à 20h (synced_at), figés après le 31/12. Recopie les montants renvoyés.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
];

const handlers: ToolModule["handlers"] = {
  get_team_pot: async (_input, ctx) => {
    ctx.onProgress("Reading the team pot...");
    const view = await readTeamPot();
    if (!view.ok) return `Pot d'équipe illisible (base CoachelloHQ) : ${view.error}. Ne donne aucun chiffre du pot.`;
    if (!view.state) return "Le pot d'équipe n'a pas encore été synchronisé : aucun chiffre disponible pour l'instant.";
    const s = view.state;
    const pace = potPace(s);

    return JSON.stringify({
      source: "CoachelloHQ /pot (snapshot horaire de l'onglet Factures du sheet revenue)",
      synced_at: view.syncedAt,
      stale: view.stale,
      ended: view.ended,
      rules: {
        counted_invoices: `facturé New + Renew daté du ${POT_LAUNCH_DAY} au ${POT_LAST_DAY}`,
        baseline_before_launch: POT_BASELINE,
        milestones: `tous les ${POT_STEP} € de ${POT_START} à ${POT_END_LEVEL}`,
        bonus_per_milestone: `${POT_BONUS} € jusqu'à ${POT_GATE}, ${POT_ACCEL_BONUS} € au-delà`,
        ai_multiplier: POT_AI_MULTIPLIER,
        max_pot_without_ai_bonus: POT_MAX,
      },
      revenue_2026_tracked: s.total,
      added_since_launch: s.added,
      pot: s.pot,
      pot_from_milestones: s.milestonePot,
      pot_from_ai_bonus: s.aiBonus,
      milestones_reached: s.reachedCount,
      next_milestone: s.next ? { level: s.next.level, to_go: s.next.toGo, bonus: s.next.bonus } : null,
      pace: {
        days_left: pace.daysLeft,
        to_goal_2_7m: pace.toGate,
        per_week_to_goal: Math.round(pace.perWeekToGate),
        to_3m: pace.toEnd,
        per_week_to_3m: Math.round(pace.perWeekToEnd),
      },
      milestones: s.milestones
        .filter((m) => m.reached)
        .map((m) => ({
          level: m.level,
          bonus: m.bonus,
          reached_at: m.reachedAt,
          crossed_by: m.crossedBy
            ? { company: m.crossedBy.company, owner: m.crossedBy.owner, amount: m.crossedBy.amount, date: m.crossedBy.date, ai: m.crossedBy.isAi }
            : null,
        })),
      wins_since_launch: s.wins.map((w) => ({
        date: w.date,
        company: w.company,
        amount: w.amount,
        type: w.kind,
        ai: w.isAi,
        owner: w.owner,
        ai_bonus: w.aiBonus,
      })),
      last_invoice_in_sheet: s.lastInvoiceDate,
    });
  },
};

export const teamPotTools: ToolModule = { defs, handlers };

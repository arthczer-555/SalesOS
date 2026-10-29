/**
 * get_lost_deals_to_reopen : les deals perdus à relancer, lus dans les analyses
 * de perte de CoachelloHQ (table deal_loss_analyses : page /deals, colonne
 * Closed lost, tri "Reopen date"). La date de relance, le "quand et comment"
 * et la cause de la perte ne sont PAS des propriétés HubSpot : sans cet outil,
 * un agent cherche un champ "reopen date" dans HubSpot et ne trouve rien.
 *
 * Accès : par défaut les deals de l'utilisateur ; un admin peut demander un
 * owner précis ou toute l'équipe, un non-admin ne voit que les siens (même
 * règle que get_sales_activity). Un agent envoyé à une audience tourne avec
 * l'identité de chaque destinataire : chacun reçoit ses propres deals.
 * Source agents : "hubspot" (lib/agents/tools.ts).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import {
  CONTROLLABLE_LABELS,
  LOSS_ANALYSIS_SCHEMA_VERSION,
  lossReasonLabel,
  type LossAnalysis,
} from "@/lib/deals/loss-analysis";
import { isIsoDay, parisToday } from "./period";
import { viewer } from "./viewer";
import type { ToolModule } from "./types";

const MAX_DEALS = 50;
// Liste allégée (summary_only) : de quoi comparer tout un mois avant de choisir.
const MAX_SUMMARY = 300;
// Lignes lues pour compter la fenêtre entière (le détail reste plafonné à MAX_DEALS).
const MAX_ROWS = 1000;

const defs: Anthropic.Tool[] = [
  {
    name: "get_lost_deals_to_reopen",
    description:
      "Deals perdus (closed lost du Sales Pipeline) à relancer, issus des analyses de perte de CoachelloHQ (page Deals, colonne Closed lost). Pour chaque deal : date de relance suggérée, pourquoi cette date, qui contacter, comment revenir, signal à surveiller, et pourquoi il a été perdu (raison principale et secondaire, explication, cause racine, raison saisie dans HubSpot), plus le lien vers la fiche. Ces informations ne sont PAS des propriétés HubSpot : utilise cet outil, ne cherche pas de champ \"reopen date\" dans HubSpot. Fenêtre sur la date de relance (défaut : mois en cours, heure de Paris) ; include_overdue ajoute les relances dont la date est passée. Détail des 50 relances les plus proches (même date : plus gros montant d'abord), total = nombre exact de la fenêtre. Pour CHOISIR parmi toute la fenêtre (ex. les 10 meilleurs) : summary_only renvoie une liste allégée de tous les deals (jusqu'à 300 : montant, dates, raison, part de responsabilité, pourquoi cette date), puis rappelle l'outil avec deal_ids pour le détail des deals retenus. Seuls les deals déjà analysés y figurent (analyses_available le précise). Accès : par défaut les deals de l'utilisateur ; un admin peut viser un owner ou toute l'équipe.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: { type: "string", description: "Début de la fenêtre de relance, YYYY-MM-DD inclus. Défaut : 1er jour du mois en cours." },
        to: { type: "string", description: "Fin de la fenêtre de relance, YYYY-MM-DD inclus. Défaut : dernier jour du mois en cours." },
        include_overdue: { type: "boolean", description: "Ajoute les deals dont la date de relance est antérieure à from (relances en retard). Défaut false." },
        my_deals_only: { type: "boolean", description: "Défaut true : deals de l'utilisateur. false = toute l'équipe (admin uniquement)." },
        owner_id: { type: "string", description: "Owner HubSpot visé (admin uniquement), résolu depuis la liste d'équipe du contexte." },
        summary_only: { type: "boolean", description: "true : liste allégée de TOUTE la fenêtre (jusqu'à 300 deals), sans qui / comment, pour comparer et choisir. Défaut false." },
        deal_ids: { type: "array", items: { type: "string" }, description: "Ids de deals (50 max) : renvoie leur détail complet, la fenêtre est ignorée. Sert après summary_only." },
      },
      required: [],
    },
  },
];

type Row = {
  deal_id: string;
  reopen_date: string;
  owner_id: string | null;
  analysis: LossAnalysis;
  reopen_task_created_at: string | null;
};

type DealProps = Record<string, string | null>;

function monthBounds(today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

async function readDeals(ids: string[]): Promise<Map<string, DealProps>> {
  const out = new Map<string, DealProps>();
  // batch/read refuse plus de 100 ids.
  for (let i = 0; i < ids.length; i += 100) {
    const res = await hubspotFetch<{ results?: { id: string; properties: DealProps }[] }>(
      "/crm/v3/objects/deals/batch/read",
      "POST",
      {
        inputs: ids.slice(i, i + 100).map((id) => ({ id })),
        properties: ["dealname", "amount", "hubspot_owner_id", "hs_is_closed_lost", "hs_v2_date_entered_closedlost", "closedate", "closed_lost_reason"],
      },
    );
    for (const d of res.results ?? []) out.set(d.id, d.properties);
  }
  return out;
}

async function ownerNames(): Promise<Map<string, string>> {
  const res = await hubspotFetch<{ results?: { id: string; firstName?: string; lastName?: string }[] }>("/crm/v3/owners?limit=100")
    .catch(() => ({ results: [] as { id: string; firstName?: string; lastName?: string }[] }));
  return new Map((res.results ?? []).map((o) => [o.id, [o.firstName, o.lastName].filter(Boolean).join(" ")]));
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "").replace(/\/$/, "");
}

const handlers: ToolModule["handlers"] = {
  get_lost_deals_to_reopen: async (input, ctx) => {
    const today = parisToday();
    const month = monthBounds(today);
    const from = isIsoDay(input.from) ? input.from : month.from;
    const to = isIsoDay(input.to) ? input.to : month.to;
    if (from > to) return JSON.stringify({ error: `from (${from}) est après to (${to}).` });
    const includeOverdue = input.include_overdue === true;

    // Périmètre : un non-admin ne voit que ses deals, quoi qu'il demande.
    const who = await viewer(ctx);
    let ownerId: string | null = null;
    if (!who.isAdmin) {
      if (!ctx.userOwnerId) {
        return JSON.stringify({ error: "Aucun owner HubSpot n'est relié à ce compte CoachelloHQ : impossible de retrouver ses deals perdus." });
      }
      ownerId = ctx.userOwnerId;
    } else if (typeof input.owner_id === "string" && /^\d+$/.test(input.owner_id)) {
      ownerId = input.owner_id;
    } else if (input.my_deals_only !== false) {
      ownerId = ctx.userOwnerId;
    }

    const dealIds = Array.isArray(input.deal_ids)
      ? input.deal_ids.filter((x): x is string => typeof x === "string" && /^\d+$/.test(x)).slice(0, MAX_DEALS)
      : [];
    const summaryOnly = input.summary_only === true && dealIds.length === 0;

    ctx.onProgress("Reading lost deal analyses…");
    let query = db
      .from("deal_loss_analyses")
      .select("deal_id, reopen_date, owner_id, analysis, reopen_task_created_at")
      .eq("status", "done")
      .not("reopen_date", "is", null)
      .order("reopen_date", { ascending: true })
      .limit(MAX_ROWS);
    if (dealIds.length) query = query.in("deal_id", dealIds);
    else {
      query = query.lte("reopen_date", to);
      if (!includeOverdue) query = query.gte("reopen_date", from);
    }
    // Le périmètre s'applique aussi à deal_ids : un non-admin n'obtient que ses deals.
    if (ownerId) query = query.eq("owner_id", ownerId);
    const { data, error } = await query;
    if (error) return JSON.stringify({ error: `Analyses de perte illisibles : ${error.message}` });

    let countQuery = db.from("deal_loss_analyses").select("deal_id", { count: "exact", head: true }).eq("status", "done");
    if (ownerId) countQuery = countQuery.eq("owner_id", ownerId);
    const { count: analyzed } = await countQuery;

    const rows = ((data ?? []) as Row[]).filter((r) => r.analysis?.schemaVersion === LOSS_ANALYSIS_SCHEMA_VERSION);
    const [deals, owners] = await Promise.all([readDeals(rows.map((r) => r.deal_id)), ownerNames()]);
    const base = appUrl();

    // Un deal rouvert depuis l'analyse n'est plus à relancer. Même date de
    // relance (fréquent : le batch en a posé des dizaines le même jour) : le
    // plus gros montant d'abord.
    const amountOf = (id: string) => Number(deals.get(id)?.amount) || 0;
    const stillLost = rows
      .filter((r) => deals.get(r.deal_id)?.hs_is_closed_lost === "true")
      .sort((a, b) => a.reopen_date.localeCompare(b.reopen_date) || amountOf(b.deal_id) - amountOf(a.deal_id));
    const lostOn = (p: DealProps) => (p.hs_v2_date_entered_closedlost || p.closedate || "").slice(0, 10) || null;
    const limit = summaryOnly ? MAX_SUMMARY : MAX_DEALS;

    const summaries = summaryOnly
      ? stillLost.slice(0, limit).map((r) => {
          const p = deals.get(r.deal_id) ?? {};
          return {
            deal_id: r.deal_id,
            name: p.dealname ?? "",
            amount_eur: p.amount ? Number(p.amount) : null,
            ...(ownerId ? {} : { owner: owners.get(p.hubspot_owner_id ?? r.owner_id ?? "") || null }),
            lost_on: lostOn(p),
            reopen_date: r.reopen_date,
            overdue: r.reopen_date < today,
            primary_reason: lossReasonLabel(r.analysis.primaryReason),
            loss_on_our_side: CONTROLLABLE_LABELS[r.analysis.controllable] ?? null,
            why_then: r.analysis.reopen.timing,
          };
        })
      : null;
    const items = summaries ?? stillLost
      .slice(0, limit)
      .map((r) => {
        const p = deals.get(r.deal_id) ?? {};
        const a = r.analysis;
        const root = a.chain?.find((c) => c.level === "root_cause") ?? a.chain?.[a.chain.length - 1];
        return {
          deal_id: r.deal_id,
          name: p.dealname ?? "",
          amount_eur: p.amount ? Number(p.amount) : null,
          owner: owners.get(p.hubspot_owner_id ?? r.owner_id ?? "") || null,
          lost_on: lostOn(p),
          reopen_date: r.reopen_date,
          overdue: r.reopen_date < today,
          hubspot_task_created: !!r.reopen_task_created_at,
          why_lost: {
            primary_reason: lossReasonLabel(a.primaryReason),
            secondary_reason: a.secondaryReason ? lossReasonLabel(a.secondaryReason) : null,
            explanation: a.reasonExplanation,
            root_cause: root?.text ?? null,
            declared_in_hubspot: p.closed_lost_reason?.trim() || null,
          },
          reopen_plan: {
            why_then: a.reopen.timing,
            who: a.reopen.who,
            how: a.reopen.how,
            watch_for: a.reopen.watchFor,
          },
          link: base ? `${base}/deals?dealId=${r.deal_id}` : `/deals?dealId=${r.deal_id}`,
        };
      });

    const capped = (data ?? []).length === MAX_ROWS;
    return JSON.stringify({
      ...(dealIds.length
        ? { deal_ids: dealIds, not_found: dealIds.filter((id) => !stillLost.some((r) => r.deal_id === id)) }
        : { window: { from: includeOverdue ? null : from, to, include_overdue: includeOverdue } }),
      scope: ownerId ? { owner: owners.get(ownerId) || ownerId } : "whole team",
      analyses_available: analyzed ?? null,
      note:
        "Seuls les deals perdus déjà analysés figurent ici (analyse en masse en cours sur l'historique). Les textes sont dans la langue des échanges du deal.",
      total: capped ? `plus de ${MAX_ROWS}` : stillLost.length,
      count: items.length,
      ...(stillLost.length > limit || capped
        ? {
            truncated: summaryOnly
              ? `Liste allégée limitée aux ${limit} relances les plus proches sur ${capped ? `plus de ${MAX_ROWS}` : stillLost.length}. Resserre la fenêtre ou vise un owner.`
              : `Seules les ${limit} relances les plus proches sont détaillées sur ${capped ? `plus de ${MAX_ROWS}` : stillLost.length}. Pour choisir parmi toutes : summary_only, puis deal_ids.`,
          }
        : {}),
      deals_page: base ? `${base}/deals` : "/deals",
      deals: items,
    });
  },
};

export const lostDealsTools: ToolModule = { defs, handlers };

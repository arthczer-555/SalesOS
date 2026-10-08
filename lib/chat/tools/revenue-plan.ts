/**
 * Outils "objectifs & prévisionnel" du sheet revenue, en complément de
 * get_billing_revenue (CA par client et par année), get_revenue_kpis
 * (agrégés) et get_invoices (facture par facture) :
 *
 *  - get_client_targets   : objectif vs facturé PAR CLIENT (année + trimestres,
 *                           objectif actualisé, statut YoY).
 *  - get_sales_targets    : objectif vs facturé PAR COMMERCIAL (New en AE,
 *                           Renew en AM, Renew en CSM). Même règle d'accès que
 *                           le dashboard : un admin voit tout le monde, un
 *                           non-admin ne voit que sa propre ligne.
 *  - get_revenue_forecast : prévisionnel 2026 (synthèse par trimestre, deals
 *                           new biz pondérés, revue weekly des sales).
 *
 * Les totaux sont calculés en code, le modèle les recopie. Lecture :
 * lib/billing/client-targets.ts, lib/billing/forecast.ts,
 * lib/ae-activity/revenue-sheet.ts (onglets Suivi, déjà utilisé par le
 * dashboard AE : mêmes chiffres des deux côtés).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { norm, sheetGrid } from "@/lib/billing/drive-xlsx";
import { cellNumber, cellText, findHeader, getRevenueWorkbook } from "@/lib/billing/revenue-workbook";
import { fetchClientTargets, type ClientTarget, type Quarter } from "@/lib/billing/client-targets";
import { fetchForecast, fetchWeeklyForecast } from "@/lib/billing/forecast";
import { fetchRevenueSheet, repKeyFromName } from "@/lib/ae-activity/revenue-sheet";
import type { RevenueStream } from "@/lib/ae-activity/types";
import type { ToolContext, ToolModule } from "./types";

const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];
const round = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: (number | null)[]) => round(xs.reduce<number>((s, x) => s + (x ?? 0), 0));
const asQuarter = (v: unknown): Quarter | null => (QUARTERS as string[]).includes(String(v).toUpperCase()) ? (String(v).toUpperCase() as Quarter) : null;

const defs: Anthropic.Tool[] = [
  {
    name: "get_client_targets",
    description:
      "Objectif vs facturé PAR CLIENT pour 2026 (sheet revenue, onglets Clients + Budget vs Actual + Targets + YoY), totaux calculés. Par client : statut commercial (Renew / New / En attente), AE / AM / CSM, facturé 2025, target 2026, target actualisé, facturé 2026, écart (négatif = en retard), % d'atteinte, target et facturé par trimestre, croissance YoY et statut YoY (Expansion, Contraction, Churned, New, In wait, Inactive). À utiliser pour : 'quels clients sont en retard sur leur objectif', 'objectif vs facturé de X', 'mes comptes vs target' (owner = prénom), 'clients churnés / en expansion', 'reste à facturer ce trimestre'. Pour le CA d'un client sur plusieurs années : get_billing_revenue. Pour une période en dates : get_invoices.",
    input_schema: {
      type: "object" as const,
      properties: {
        company: { type: "string", description: "Filtre société (matching flou)." },
        owner: { type: "string", description: "Prénom de l'AE / AM / CSM tel qu'écrit dans le sheet." },
        owner_role: { type: "string", enum: ["any", "ae", "am", "csm"], description: "Colonne où chercher owner (défaut any)." },
        status: { type: "string", description: "Statut commercial du sheet : Renew, New ou En attente." },
        yoy_status: { type: "string", enum: ["Expansion", "Contraction", "Churned", "New", "In wait", "Inactive"] },
        quarter: { type: "string", enum: ["Q1", "Q2", "Q3", "Q4"], description: "Compare target et facturé de CE trimestre au lieu de l'année." },
        only_behind: { type: "boolean", description: "Seulement les clients sous leur target (sur l'année ou le trimestre choisi)." },
        sort_by: { type: "string", enum: ["gap", "target", "billed", "achievement"], description: "gap (défaut) = les plus en retard d'abord." },
        limit: { type: "number", description: "Clients listés (défaut 40, max 120). Les totaux portent sur tous les clients filtrés." },
      },
      required: [],
    },
  },
  {
    name: "get_sales_targets",
    description:
      "Objectif vs facturé PAR COMMERCIAL en 2026 (sheet revenue, onglets Suivi New / Suivi Renew / Suivi CSM, mêmes chiffres que le dashboard AE) : New facturé en tant qu'AE, Renew en tant qu'AM, Renew en tant que CSM, sur l'année et par trimestre, avec le détail des comptes facturés. Accès : un admin voit toute l'équipe ; un non-admin ne voit QUE sa propre ligne (si on te demande les chiffres d'un collègue sans être admin, dis que c'est réservé aux admins). Pour les objectifs société agrégés : get_revenue_kpis.",
    input_schema: {
      type: "object" as const,
      properties: {
        person: { type: "string", description: "Prénom du commercial. Omets pour l'utilisateur lui-même (ou toute l'équipe si admin)." },
        stream: { type: "string", enum: ["all", "new", "renew", "csm"], description: "Flux (défaut all)." },
        include_accounts: { type: "boolean", description: "Ajoute le détail des comptes facturés (défaut false)." },
      },
      required: [],
    },
  },
  {
    name: "get_revenue_forecast",
    description:
      "Prévisionnel 2026 du sheet revenue (onglet Forecast + revue weekly des sales). view='summary' (défaut) : prévu vs facturé par trimestre pour le Renew, le New biz pondéré par AE et le total. view='deals' : deals new biz du forecast (AE, société, proba, trimestre, montant, pondéré, statut, commentaire), filtrables, avec totaux ; ce détail n'est pas tenu à jour pour tous les trimestres. view='weekly' + quarter : la revue weekly des sales du trimestre, la vue la plus à jour au niveau deal (par AE : société, commentaire, modalité Human/Hybrid, type Direct/RFP, proba, mois visé, montant). Ce sont des PRÉVISIONS saisies par l'équipe, pas du facturé : présente-les comme telles. Pour le pipeline HubSpot en direct : outils HubSpot.",
    input_schema: {
      type: "object" as const,
      properties: {
        view: { type: "string", enum: ["summary", "deals", "weekly"] },
        quarter: { type: "string", enum: ["Q1", "Q2", "Q3", "Q4"], description: "Filtre trimestre (obligatoire pour view='weekly')." },
        ae: { type: "string", description: "Prénom de l'AE." },
        company: { type: "string", description: "Filtre société (matching flou)." },
        min_probability: { type: "number", description: "Proba minimale (0 à 1)." },
        include_lost: { type: "boolean", description: "Inclut les deals perdus (défaut false)." },
      },
      required: [],
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

const fuzzy = (value: string | null | undefined, query: string) => {
  if (!value) return false;
  const v = norm(value);
  return v.includes(query) || query.includes(v);
};

async function viewer(ctx: ToolContext): Promise<{ isAdmin: boolean; repKey: string; name: string | null }> {
  const { data } = await db.from("users").select("name, email, is_admin").eq("id", ctx.userId).maybeSingle();
  const name = (data?.name as string | null) ?? null;
  return { isAdmin: !!data?.is_admin, repKey: repKeyFromName(name ?? (data?.email as string | undefined) ?? ""), name };
}

type StreamKey = "new" | "renew" | "csm";

/**
 * Objectifs ACTUALISÉS par commercial (colonne "Obj Actualisé" / "Target
 * Actu" des onglets Suivi). Le parseur du dashboard AE ne lit que l'objectif
 * initial, alors que le "% Atteinte" du sheet est calculé sur l'actualisé : on
 * expose les deux. Un actualisé à 0 ou vide = non renseigné.
 */
async function updatedTargets(): Promise<Record<StreamKey, Map<string, number>>> {
  const out: Record<StreamKey, Map<string, number>> = { new: new Map(), renew: new Map(), csm: new Map() };
  const wb = await getRevenueWorkbook();
  const spec: [StreamKey, string, string][] = [
    ["new", "Suivi New", "obj actualise"],
    ["renew", "Suivi Renew", "target actu"],
    ["csm", "Suivi CSM", "target actu"],
  ];
  for (const [key, tab, label] of spec) {
    const grid = sheetGrid(wb, tab);
    const head = findHeader(grid, ["ae", label]);
    if (!head) continue;
    for (const row of grid.slice(head.row + 1)) {
      const name = cellText(row[head.col("ae")]);
      if (!name || /^total/i.test(name)) break;
      const v = cellNumber(row[head.col(label)]);
      if (v) out[key].set(repKeyFromName(name), v);
    }
  }
  return out;
}

function streamOut(s: RevenueStream, updated: number | undefined, withAccounts: boolean) {
  return {
    target: s.target,
    target_updated: updated ?? null,
    billed: s.billed,
    achievement: s.billed != null && s.target ? round(s.billed / s.target) : null,
    achievement_vs_updated: s.billed != null && updated ? round(s.billed / updated) : null,
    gap: s.billed != null && s.target != null ? round(s.billed - s.target) : null,
    quarters: s.quarters,
    ...(withAccounts ? { accounts: s.accounts } : {}),
  };
}

// ── Handlers ───────────────────────────────────────────────────────────────

const module_: ToolModule = {
  defs,
  handlers: {
    get_client_targets: async (input, ctx) => {
      try {
        ctx.onProgress("Reading client targets...");
        const res = await fetchClientTargets();
        if (!res.ok) return `Objectifs clients illisibles dans le sheet revenue : ${res.error}. Ne donne aucun objectif ; dis que la source est indisponible.`;
        ctx.onSource({ kind: "billing", title: "Sheet revenue (Clients, Budget vs Actual, Targets, YoY)" });

        const company = typeof input.company === "string" && input.company.trim() ? norm(input.company) : null;
        const owner = typeof input.owner === "string" && input.owner.trim() ? norm(input.owner) : null;
        const role = (["ae", "am", "csm"] as const).find((r) => r === input.owner_role) ?? "any";
        const status = typeof input.status === "string" && input.status.trim() ? norm(input.status) : null;
        const yoy = typeof input.yoy_status === "string" && input.yoy_status.trim() ? norm(input.yoy_status) : null;
        const quarter = asQuarter(input.quarter);
        const sortBy = (["gap", "target", "billed", "achievement"] as const).find((s) => s === input.sort_by) ?? "gap";
        const limit = Math.min(120, Math.max(1, Number(input.limit) || 40));

        // Valeurs comparées : l'année, ou le trimestre demandé.
        const view = (t: ClientTarget) => {
          if (!quarter) return { target: t.target2026, billed: t.billed2026, gap: t.gap, achievement: t.achievement == null ? null : round(t.achievement * 10) / 10 };
          const q = t.quarters.find((x) => x.quarter === quarter);
          const target = q?.target ?? null;
          const billed = q?.billed ?? null;
          return {
            target,
            billed,
            gap: target != null || billed != null ? round((billed ?? 0) - (target ?? 0)) : null,
            achievement: target ? round((billed ?? 0) / target) : null,
          };
        };

        const filtered = res.clients.filter((t) => {
          if (company && !fuzzy(t.company, company)) return false;
          if (owner && !(role === "any" ? [t.ae, t.am, t.csm] : [t[role]]).some((f) => fuzzy(f, owner))) return false;
          if (status && norm(t.status) !== status) return false;
          if (yoy && norm(t.yoyStatus) !== yoy) return false;
          if (input.only_behind === true) {
            const v = view(t);
            if (!(v.target && (v.billed ?? 0) < v.target)) return false;
          }
          return true;
        });

        const key = (t: ClientTarget) => view(t)[sortBy] ?? (sortBy === "gap" || sortBy === "achievement" ? Infinity : -Infinity);
        const sorted = [...filtered].sort((a, b) => (sortBy === "gap" || sortBy === "achievement" ? key(a) - key(b) : key(b) - key(a)));
        // Les targets par client sont des targets de RENEW (clients existants) :
        // l'atteinte ne se calcule que sur les clients qui en ont un, le
        // facturé des clients sans target (souvent New) est donné à part.
        const views = filtered.map(view);
        const targeted = views.filter((v) => (v.target ?? 0) > 0);
        const totalTarget = sum(targeted.map((v) => v.target));
        const billedTargeted = sum(targeted.map((v) => v.billed));
        const billedUntargeted = sum(views.filter((v) => !((v.target ?? 0) > 0)).map((v) => v.billed));
        const byYoy: Record<string, number> = {};
        for (const t of filtered) byYoy[t.yoyStatus ?? "(none)"] = (byYoy[t.yoyStatus ?? "(none)"] ?? 0) + 1;

        const notes = [
          "Montants en euros, totaux calculés par l'outil : recopie-les.",
          "achievement = facturé / target en fraction (1.06 = 106 %). gap = facturé - target (négatif = en retard). Un client sans target (0 ou vide) n'a pas d'achievement.",
          "Les targets par client sont des targets de RENEW (clients existants) : sur tous les clients, leur somme est le target Renew société. Le facturé des clients sans target (souvent des New) est dans billed_on_clients_without_target, ne le compare pas aux targets.",
          quarter ? `Comparaison sur ${quarter} uniquement.` : "Comparaison sur l'année 2026 (target initial ; target_updated = target actualisé en cours d'année).",
          ...res.warnings,
        ];
        if (company && filtered.length === 0) notes.push(`Aucun client "${input.company}" dans les onglets d'objectifs. Clients présents : ${res.clients.map((c) => c.company).join(", ")}.`);

        return JSON.stringify({
          source: "sheet revenue (Clients, Budget vs Actual, Targets, YoY 2025 vs 2026)",
          period: quarter ?? "2026",
          totals: {
            target: totalTarget,
            billed_on_targeted_clients: billedTargeted,
            gap: round(billedTargeted - totalTarget),
            achievement: totalTarget ? round(billedTargeted / totalTarget) : null,
            billed_on_clients_without_target: billedUntargeted,
            billed_total: round(billedTargeted + billedUntargeted),
            clients: filtered.length,
            clients_with_target: targeted.length,
            clients_behind: targeted.filter((v) => (v.billed ?? 0) < (v.target ?? 0)).length,
          },
          clients_by_yoy_status: byYoy,
          clients: sorted.slice(0, limit).map((t) => ({
            company: t.company,
            status: t.status,
            ae: t.ae,
            am: t.am,
            csm: t.csm,
            ...view(t),
            target_2026: t.target2026,
            target_updated: t.targetUpdated,
            billed_2026: t.billed2026,
            billed_2025: t.billed2025,
            yoy_growth: t.yoyGrowth == null ? null : Math.round(t.yoyGrowth * 1000) / 1000,
            yoy_status: t.yoyStatus,
            quarters: t.quarters,
          })),
          clients_listed: Math.min(limit, sorted.length),
          notes,
        });
      } catch (e) {
        return `Erreur lecture des objectifs clients : ${e instanceof Error ? e.message : "inconnue"}.`;
      }
    },

    get_sales_targets: async (input, ctx) => {
      try {
        ctx.onProgress("Reading sales targets...");
        const [sheet, me, updated] = await Promise.all([fetchRevenueSheet(), viewer(ctx), updatedTargets().catch(() => null)]);
        if (!sheet.ok) return "Onglets Suivi New / Renew / CSM du sheet revenue illisibles. Ne donne aucun objectif commercial ; dis que la source est indisponible.";
        ctx.onSource({ kind: "billing", title: "Sheet revenue (Suivi New, Suivi Renew, Suivi CSM)" });

        const requested = typeof input.person === "string" && input.person.trim() ? repKeyFromName(input.person) : null;
        if (!me.isAdmin && requested && requested !== me.repKey) {
          return `Les objectifs et le facturé d'un autre commercial sont réservés aux admins (même règle que le dashboard). ${me.name ?? "L'utilisateur"} peut consulter ses propres chiffres, et les totaux société via get_revenue_kpis.`;
        }
        const keys = me.isAdmin ? (requested ? [requested] : [...sheet.byRep.keys()]) : [me.repKey];
        const stream = (["new", "renew", "csm"] as const).find((s) => s === input.stream) ?? "all";
        const withAccounts = input.include_accounts === true;

        const people = keys
          .map((k) => ({ key: k, rep: sheet.byRep.get(k) }))
          .filter((p) => !!p.rep)
          .map(({ key, rep }) => ({
            person: key.charAt(0).toUpperCase() + key.slice(1),
            ...(stream === "all" || stream === "new" ? { new_as_ae: streamOut(rep!.newBiz, updated?.new.get(key), withAccounts) } : {}),
            ...(stream === "all" || stream === "renew" ? { renew_as_am: streamOut(rep!.renew, updated?.renew.get(key), withAccounts) } : {}),
            ...(stream === "all" || stream === "csm" ? { renew_as_csm: streamOut(rep!.csmRenew, updated?.csm.get(key), withAccounts) } : {}),
          }))
          // Un CSM n'a pas de New, un AE pur pas de Renew CSM : on ne liste pas les flux vides.
          .map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v !== "object" || v === null || (v as { target: unknown; billed: unknown }).target != null || (v as { target: unknown; billed: unknown }).billed != null)))
          .filter((p) => Object.keys(p).length > 1);
        if (people.length === 0) {
          return me.isAdmin
            ? `Aucun commercial "${input.person}" dans les onglets Suivi. Présents : ${[...sheet.byRep.keys()].join(", ")}.`
            : `${me.name ?? "L'utilisateur"} n'apparaît pas dans les onglets Suivi du sheet revenue (pas d'objectif commercial à son nom).`;
        }
        return JSON.stringify({
          source: "sheet revenue (Suivi New, Suivi Renew, Suivi CSM)",
          scope: me.isAdmin ? "admin : toute l'équipe" : "non-admin : uniquement l'utilisateur",
          people,
          notes: [
            "achievement = facturé / objectif initial ; achievement_vs_updated = facturé / objectif actualisé (target_updated, révisé en cours d'année). Le '% Atteinte' affiché dans le sheet est calculé sur l'actualisé : quand les deux existent, donne les deux en le précisant. gap = facturé - objectif initial (négatif = en retard).",
            "Le Renew CSM porte le même revenu que le Renew AM vu côté delivery : ne les additionne jamais (total société = New + Renew AM).",
          ],
        });
      } catch (e) {
        return `Erreur lecture des objectifs commerciaux : ${e instanceof Error ? e.message : "inconnue"}.`;
      }
    },

    get_revenue_forecast: async (input, ctx) => {
      try {
        ctx.onProgress("Reading revenue forecast...");
        const view = input.view === "deals" || input.view === "weekly" ? input.view : "summary";
        const quarter = asQuarter(input.quarter);
        const ae = typeof input.ae === "string" && input.ae.trim() ? norm(input.ae) : null;
        const company = typeof input.company === "string" && input.company.trim() ? norm(input.company) : null;
        const minProba = typeof input.min_probability === "number" ? input.min_probability : null;
        const includeLost = input.include_lost === true;
        const disclaimer = "Prévisions saisies par l'équipe dans le sheet, pas du facturé.";

        if (view === "weekly") {
          if (!quarter) return "view='weekly' demande un quarter (Q1 à Q4).";
          const res = await fetchWeeklyForecast(quarter);
          if (!res.ok) return `Revue weekly illisible : ${res.error}`;
          ctx.onSource({ kind: "billing", title: `Sheet revenue (${res.tab})` });
          const deals = res.deals.filter(
            (d) => (!ae || fuzzy(d.ae, ae)) && (!company || fuzzy(d.company, company)) && (minProba == null || (d.probability ?? 0) >= minProba),
          );
          const byAe: Record<string, { amount: number; weighted: number; deals: number }> = {};
          for (const d of deals) {
            const k = d.ae ?? "(none)";
            byAe[k] ??= { amount: 0, weighted: 0, deals: 0 };
            byAe[k].amount = round(byAe[k].amount + (d.amount ?? 0));
            byAe[k].weighted = round(byAe[k].weighted + (d.amount ?? 0) * (d.probability ?? 0));
            byAe[k].deals++;
          }
          return JSON.stringify({
            source: `sheet revenue (${res.tab})`,
            totals: { amount: sum(deals.map((d) => d.amount)), weighted: round(deals.reduce((s, d) => s + (d.amount ?? 0) * (d.probability ?? 0), 0)), deals: deals.length },
            by_ae: byAe,
            deals,
            notes: [disclaimer, "weighted = montant x proba, calculé par l'outil."],
          });
        }

        const res = await fetchForecast();
        if (!res.ok) return `Forecast illisible : ${res.error}. Ne donne aucun prévisionnel ; dis que la source est indisponible.`;
        ctx.onSource({ kind: "billing", title: "Sheet revenue (Forecast)" });

        if (view === "summary") {
          const lines = ae ? res.lines.filter((l) => fuzzy(l.label, ae) || /^(renew|total)/i.test(l.label)) : res.lines;
          return JSON.stringify({
            source: "sheet revenue (Forecast)",
            lines: lines.map((l) => ({
              label: l.label,
              quarters: quarter ? l.quarters.filter((q) => q.quarter === quarter) : l.quarters,
              total_2026: l.total,
            })),
            notes: [disclaimer, "forecast = prévu (pondéré pour le new biz), billed = déjà facturé sur le trimestre."],
          });
        }

        const deals = res.deals.filter(
          (d) =>
            (includeLost || !/lost|perdu/i.test(d.status ?? "")) &&
            (!ae || fuzzy(d.ae, ae)) &&
            (!company || fuzzy(d.company, company)) &&
            (!quarter || (d.quarter ?? "").toUpperCase() === quarter) &&
            (minProba == null || (d.probability ?? 0) >= minProba),
        );
        // Couverture : le détail du Forecast n'est pas tenu à jour pour tous les
        // trimestres (constaté le 2026-10-02 : quasi uniquement Q2). Un 0 deal
        // sur un trimestre ne veut pas dire "aucun deal prévu".
        const coverage: Record<string, number> = {};
        for (const d of res.deals) if (!/lost|perdu/i.test(d.status ?? "")) coverage[d.quarter ?? "?"] = (coverage[d.quarter ?? "?"] ?? 0) + 1;
        const notes = [disclaimer, includeLost ? "Deals perdus inclus." : "Deals perdus exclus (include_lost pour les voir)."];
        if (quarter && !coverage[quarter]) {
          notes.push(
            `Le détail des deals du Forecast n'a aucun deal actif pour ${quarter} : il n'est pas tenu à jour pour ce trimestre. Ne conclus pas qu'aucun deal n'est prévu : appelle get_revenue_forecast avec view='weekly' et quarter='${quarter}' (revue weekly des sales, plus récente).`,
          );
        }
        return JSON.stringify({
          source: "sheet revenue (Forecast, détail des deals new biz)",
          totals: { amount: sum(deals.map((d) => d.amount)), weighted: sum(deals.map((d) => d.weighted)), deals: deals.length },
          active_deals_by_quarter: coverage,
          deals: [...deals].sort((a, b) => (b.weighted ?? 0) - (a.weighted ?? 0)),
          notes,
        });
      } catch (e) {
        return `Erreur lecture du forecast : ${e instanceof Error ? e.message : "inconnue"}.`;
      }
    },
  },
};

export const revenuePlanTools = module_;

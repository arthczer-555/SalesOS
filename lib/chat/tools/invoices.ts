/**
 * Outil "factures" de CoachelloAI : l'onglet Factures du sheet revenue, une
 * ligne par facture. Il répond à ce que get_billing_revenue (par client et par
 * année) et get_revenue_kpis (agrégés par trimestre) ne savent pas faire :
 * une PÉRIODE quelconque (semaine, mois, entre deux dates) et le détail
 * facture par facture.
 *
 * Les sommes sont faites ICI, en code : le modèle recopie des totaux exacts au
 * lieu d'additionner des lignes (règle "un chiffre affiché doit être
 * vérifiable"). Conventions et pièges du classeur : lib/billing/invoices.ts.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { fetchInvoices, isBilled, type Invoice } from "@/lib/billing/invoices";
import { norm } from "@/lib/billing/drive-xlsx";
import type { ToolModule } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Les lignes 2025 sont des totaux annuels posés au 31/12/2025, pas des factures datées.
const FIRST_DATED_INVOICE_YEAR = 2026;

type Status = "billed" | "new" | "renew" | "pending" | "all";
type GroupBy = "none" | "week" | "month" | "quarter" | "company" | "ae" | "am" | "csm";

const defs: Anthropic.Tool[] = [
  {
    name: "get_invoices",
    description:
      "Factures une par une (onglet Factures du sheet revenue, source de vérité du facturé) avec les SOMMES DÉJÀ CALCULÉES. À utiliser pour toute question sur une PÉRIODE précise (cette semaine, la semaine dernière, ce mois, depuis le 1er septembre, entre deux dates), pour la liste ou la dernière facture d'un client, et pour le facturé d'un AE / AM / CSM sur une période. Facturé = statut New + Renew (même convention et même total que get_revenue_kpis) ; 'En attente' est compté à part. Recopie les totaux renvoyés, ne les recalcule jamais à la main. Les lignes 2025 sont des totaux annuels datés du 31/12/2025 : aucune granularité semaine / mois avant 2026, dis-le si on te la demande. Pour le CA annuel ou all-time d'un client et le flag RFP : get_billing_revenue. Pour le facturé vs target, le churn, la LTV : get_revenue_kpis. Si la période dépasse la dernière facture saisie (last_invoice_date), signale que la saisie peut avoir du retard au lieu d'affirmer qu'il n'y a rien eu.",
    input_schema: {
      type: "object" as const,
      properties: {
        date_from: { type: "string", description: "Début de période inclus, YYYY-MM-DD. Ex : lundi de la semaine visée." },
        date_to: { type: "string", description: "Fin de période incluse, YYYY-MM-DD." },
        company: { type: "string", description: "Filtre société (matching flou, insensible à la casse et aux accents)." },
        owner: { type: "string", description: "Prénom d'un AE / AM / CSM tel qu'écrit dans le sheet (ex : 'Quentin')." },
        owner_role: { type: "string", enum: ["any", "ae", "am", "csm"], description: "Colonne où chercher owner (défaut : any)." },
        status: {
          type: "string",
          enum: ["billed", "new", "renew", "pending", "all"],
          description: "billed (défaut) = New + Renew ; pending = En attente ; all = tout.",
        },
        type: { type: "string", enum: ["Human", "AI"], description: "Filtre type de coaching." },
        group_by: {
          type: "string",
          enum: ["none", "week", "month", "quarter", "company", "ae", "am", "csm"],
          description: "Ventilation des totaux (semaines du lundi au dimanche).",
        },
        limit: { type: "number", description: "Nombre max de factures listées (défaut 50, max 200). Les totaux portent toujours sur TOUTES les factures filtrées." },
      },
      required: [],
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const round = (n: number) => Math.round(n * 100) / 100;

function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

function groupKey(inv: Invoice, by: GroupBy): { key: string; label: string } {
  switch (by) {
    case "week": {
      const start = weekStart(inv.date);
      const end = new Date(`${start}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 6);
      const endIso = end.toISOString().slice(0, 10);
      return { key: start, label: `${dayLabel(start)} - ${dayLabel(endIso)} ${endIso.slice(0, 4)}` };
    }
    case "month":
      return { key: inv.date.slice(0, 7), label: `${MONTHS[Number(inv.date.slice(5, 7)) - 1]} ${inv.date.slice(0, 4)}` };
    case "quarter": {
      const q = Math.floor((Number(inv.date.slice(5, 7)) - 1) / 3) + 1;
      return { key: `${inv.date.slice(0, 4)}-Q${q}`, label: `Q${q} ${inv.date.slice(0, 4)}` };
    }
    case "company":
      return { key: inv.company, label: inv.company };
    case "ae":
    case "am":
    case "csm": {
      const who = inv[by] ?? "(none)";
      return { key: who, label: who };
    }
    default:
      return { key: "all", label: "all" };
  }
}

function totals(list: Invoice[]) {
  const sum = (f: (i: Invoice) => boolean) => round(list.filter(f).reduce((s, i) => s + i.amount, 0));
  return {
    billed: sum(isBilled),
    new: sum((i) => i.status === "new"),
    renew: sum((i) => i.status === "renew"),
    pending: sum((i) => i.status === "pending"),
    saas_part_of_billed: round(list.filter(isBilled).reduce((s, i) => s + i.saasAmount, 0)),
    count: list.length,
    count_billed: list.filter(isBilled).length,
  };
}

// ── Handler ────────────────────────────────────────────────────────────────

const module_: ToolModule = {
  defs,
  handlers: {
    get_invoices: async (input, ctx) => {
      try {
        ctx.onProgress("Reading invoices...");
        const res = await fetchInvoices();
        if (!res.ok) return `Onglet Factures du sheet revenue illisible : ${res.error}. Ne donne aucun montant de facturation sur une période ; dis que la source est indisponible.`;
        ctx.onSource({ kind: "billing", title: "Sheet revenue (onglet Factures)" });

        const from = isIsoDate(input.date_from) ? input.date_from : null;
        const to = isIsoDate(input.date_to) ? input.date_to : null;
        const company = typeof input.company === "string" && input.company.trim() ? norm(input.company) : null;
        const owner = typeof input.owner === "string" && input.owner.trim() ? norm(input.owner) : null;
        const role = (["ae", "am", "csm"] as const).find((r) => r === input.owner_role) ?? "any";
        const status: Status = (["billed", "new", "renew", "pending", "all"] as const).find((s) => s === input.status) ?? "billed";
        const type = input.type === "Human" || input.type === "AI" ? input.type : null;
        const groupBy: GroupBy =
          (["none", "week", "month", "quarter", "company", "ae", "am", "csm"] as const).find((g) => g === input.group_by) ?? "none";
        const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));

        const ownerMatch = (inv: Invoice) => {
          if (!owner) return true;
          const fields = role === "any" ? [inv.ae, inv.am, inv.csm] : [inv[role]];
          return fields.some((f) => !!f && norm(f).includes(owner));
        };
        const companyMatch = (inv: Invoice) => {
          if (!company) return true;
          const c = norm(inv.company);
          return c.includes(company) || company.includes(c);
        };
        const statusMatch = (inv: Invoice) =>
          status === "all" ? true : status === "billed" ? isBilled(inv) : inv.status === status;

        // Totaux par statut calculés AVANT le filtre de statut : un "billed" à 0
        // avec des factures en attente sur la période doit se voir.
        const scoped = res.invoices.filter(
          (i) => (!from || i.date >= from) && (!to || i.date <= to) && companyMatch(i) && ownerMatch(i) && (!type || i.type === type),
        );
        const filtered = scoped.filter(statusMatch).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.company.localeCompare(b.company)));

        const notes: string[] = [
          "Montants en euros, déjà sommés par l'outil : recopie-les tels quels.",
          "Facturé = New + Renew (convention du classeur, même total que get_revenue_kpis).",
        ];
        if (scoped.some((i) => Number(i.date.slice(0, 4)) < FIRST_DATED_INVOICE_YEAR)) {
          notes.push(
            "La période inclut des lignes 2025 : ce sont des totaux annuels par client datés du 31/12/2025, pas des factures datées. Aucune ventilation semaine / mois n'est possible avant 2026.",
          );
        }
        if (to && res.lastDate && to > res.lastDate) {
          notes.push(
            `Dernière facture saisie dans le sheet : ${res.lastDate}. La période va au-delà : une absence de facture après cette date peut venir d'un retard de saisie, ne conclus pas qu'il n'y a rien eu.`,
          );
        }
        if (company && filtered.length === 0 && scoped.length === 0) {
          const names = [...new Set(res.invoices.map((i) => i.company))].sort();
          notes.push(`Aucune facture pour "${input.company}". Sociétés présentes dans l'onglet : ${names.join(", ")}.`);
        }

        let groups: (ReturnType<typeof totals> & { key: string; label: string })[] | undefined;
        if (groupBy !== "none") {
          const map = new Map<string, { label: string; items: Invoice[] }>();
          for (const inv of scoped) {
            const { key, label } = groupKey(inv, groupBy);
            const g = map.get(key) ?? { label, items: [] };
            g.items.push(inv);
            map.set(key, g);
          }
          groups = [...map.entries()]
            .map(([key, g]) => ({ key, label: g.label, ...totals(g.items) }))
            .sort((a, b) =>
              ["week", "month", "quarter"].includes(groupBy) ? a.key.localeCompare(b.key) : b.billed - a.billed,
            );
        }

        return JSON.stringify({
          source: "sheet revenue (onglet Factures)",
          data_range: { first_invoice_date: res.firstDate, last_invoice_date: res.lastDate },
          period: { from: from ?? "début de l'onglet", to: to ?? "fin de l'onglet" },
          filters: { company: input.company ?? null, owner: input.owner ?? null, owner_role: role, status, type },
          totals: totals(scoped),
          ...(groups ? { group_by: groupBy, groups } : {}),
          invoices: filtered.slice(0, limit).map((i) => ({
            date: i.date,
            company: i.company,
            amount: i.amount,
            saas_part: i.saasAmount || undefined,
            type: i.type,
            status: i.statusLabel,
            ae: i.ae,
            am: i.am,
            csm: i.csm,
          })),
          invoices_listed: Math.min(limit, filtered.length),
          invoices_matching: filtered.length,
          notes,
        });
      } catch (e) {
        return `Erreur lecture des factures : ${e instanceof Error ? e.message : "inconnue"}. Ne donne aucun montant sur une période ; dis que la source est indisponible.`;
      }
    },
  },
};

export const invoicesTools = module_;

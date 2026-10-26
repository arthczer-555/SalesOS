// ────────────────────────────────────────────────────────────────────────
// Target et facturé PAR COMPTE et par trimestre, pour le détail des objectifs
// d'un rep : « sur quels comptes suis-je en retard ? ».
//
//   - Target  : onglet "Targets", bloc de gauche (une ligne par compte :
//               Target 2026, Target actualisé, Target Q1..Q4, AE / AM / CSM).
//               Ce sont des targets de RENEW : le New n'a d'objectif que par
//               rep, ses comptes n'ont donc que du facturé.
//   - Facturé : onglet "Factures", avec EXACTEMENT les filtres des formules
//               des onglets Suivi (owner du rôle = rep, année 2026, trimestre,
//               statut New ou Renew).
//
// Un compte appartient au rep par la colonne de son rôle : AE pour le New, AM
// pour le Renew, CSM pour le Renew CSM. Vérifié le 2026-10-26 sur tous les
// reps : par trimestre, la somme des comptes redonne au centime le target et
// le facturé des onglets Suivi, donc les chiffres du dashboard.
//
// Une facture attribuée à un autre owner que celui du target (ex. GORGIAS :
// target chez Leon, factures au nom de Magdalena) reste chez son owner, comme
// dans le Sheet. Le compte du target la signale dans `billedElsewhere`, sinon
// il paraîtrait en retard sans explication.
// ────────────────────────────────────────────────────────────────────────

import type * as XLSX from "xlsx";
import { norm, sheetGrid } from "@/lib/billing/drive-xlsx";
import { cellNumber, cellText, findHeader, getRevenueWorkbook } from "@/lib/billing/revenue-workbook";
import { fetchInvoices, type Invoice } from "@/lib/billing/invoices";
import { repKeyFromName, type StreamKey } from "./revenue-sheet";
import type { AccountTarget, QuarterAmount } from "./types";

// Les formules des onglets Suivi filtrent l'année en dur : le classeur est
// celui de 2026.
const SHEET_YEAR = 2026;
const QUARTERS: QuarterAmount["quarter"][] = ["Q1", "Q2", "Q3", "Q4"];

type Role = "ae" | "am" | "csm";

const STREAM_RULE: Record<StreamKey, { role: Role; status: "new" | "renew" }> = {
  newBiz: { role: "ae", status: "new" },
  renew: { role: "am", status: "renew" },
  csmRenew: { role: "csm", status: "renew" },
};

type TargetRow = {
  company: string;
  target: number | null; // Target 2026 (initial)
  revised: number | null; // Target actualisé
  quarters: (number | null)[]; // Q1..Q4
  owners: Record<Role, string>; // clés rep ("" = pas d'owner, "/" dans le Sheet)
};

export type AccountTargetsSource =
  | { ok: true; forRep: (repKey: string, stream: StreamKey) => AccountTarget[] }
  | { ok: false; error: string };

function parseTargets(wb: XLSX.WorkBook): TargetRow[] | null {
  const grid = sheetGrid(wb, "Targets");
  // Le bloc de droite (objectifs par rep) a lui aussi une colonne "AE" : `col`
  // renvoie la première occurrence, celle du bloc par compte.
  const head = findHeader(grid, ["company", "target 2026", "target q1", "target q4", "ae", "am", "csm"]);
  if (!head) return null;
  const c = head.col;

  const rows: TargetRow[] = [];
  for (const row of grid.slice(head.row + 1)) {
    const company = cellText(row[c("company")]);
    // Sous la ligne TOTAL, le Sheet garde des colonnes AE / AM / CSM orphelines.
    if (!company) continue;
    if (/^total\b/i.test(company)) break;
    rows.push({
      company,
      target: cellNumber(row[c("target 2026")]),
      revised: cellNumber(row[c("target actualise")]),
      quarters: QUARTERS.map((q) => cellNumber(row[c(`target ${q.toLowerCase()}`)])),
      owners: {
        ae: repKeyFromName(cellText(row[c("ae")])),
        am: repKeyFromName(cellText(row[c("am")])),
        csm: repKeyFromName(cellText(row[c("csm")])),
      },
    });
  }
  return rows;
}

function accountsFor(targets: TargetRow[], invoices: Invoice[], repKey: string, stream: StreamKey): AccountTarget[] {
  const { role, status } = STREAM_RULE[stream];
  const byCompany = new Map<string, AccountTarget>();
  const account = (company: string): AccountTarget => {
    const key = norm(company);
    let a = byCompany.get(key);
    if (!a) {
      a = {
        company,
        quarters: QUARTERS.map((quarter) => ({ quarter, target: null, billed: null })),
        revisedTarget: null,
        billedElsewhere: [],
      };
      byCompany.set(key, a);
    }
    return a;
  };

  if (status === "renew") {
    for (const t of targets) {
      if (!repKey || t.owners[role] !== repKey) continue;
      if (!t.quarters.some((v) => (v ?? 0) > 0)) continue;
      const a = account(t.company);
      t.quarters.forEach((v, i) => {
        a.quarters[i].target = v ?? 0;
      });
      if (t.revised != null && t.revised !== t.target) a.revisedTarget = t.revised;
    }
  }
  const targeted = new Set(byCompany.keys());

  for (const inv of invoices) {
    if (inv.year !== SHEET_YEAR || inv.status !== status) continue;
    const qi = (inv.quarter ?? 0) - 1;
    if (qi < 0 || qi > 3) continue;
    const owner = inv[role];
    if (repKey && repKeyFromName(owner) === repKey) {
      const q = account(inv.company).quarters[qi];
      q.billed = (q.billed ?? 0) + inv.amount;
    } else if (targeted.has(norm(inv.company))) {
      const list = byCompany.get(norm(inv.company))!.billedElsewhere;
      const quarter = QUARTERS[qi];
      const same = list.find((e) => e.quarter === quarter && e.owner === owner);
      if (same) same.billed += inv.amount;
      else list.push({ quarter, owner, billed: inv.amount });
    }
  }

  const sum = (a: AccountTarget, get: (q: QuarterAmount) => number | null) =>
    a.quarters.reduce((s, q) => s + (get(q) ?? 0), 0);
  return [...byCompany.values()].sort(
    (a, b) => sum(b, (q) => q.target) - sum(a, (q) => q.target) || sum(b, (q) => q.billed) - sum(a, (q) => q.billed),
  );
}

/**
 * Lit les onglets Targets et Factures une fois pour tout le refresh. Best-effort :
 * { ok: false } si l'un des deux est illisible, jamais de throw.
 */
export async function fetchAccountTargets(): Promise<AccountTargetsSource> {
  try {
    const [wb, inv] = await Promise.all([getRevenueWorkbook(), fetchInvoices()]);
    if (!inv.ok) return { ok: false, error: inv.error };
    const targets = parseTargets(wb);
    if (!targets) return { ok: false, error: 'Onglet "Targets" introuvable ou en-tête inattendu.' };
    return { ok: true, forRep: (repKey, stream) => accountsFor(targets, inv.invoices, repKey, stream) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

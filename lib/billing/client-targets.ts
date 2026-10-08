// ────────────────────────────────────────────────────────────────────────
// Objectif vs facturé PAR CLIENT, lu dans le classeur revenue. Quatre onglets
// décrivent les mêmes ~68 clients 2026, chacun avec une partie de l'info ; on
// les joint sur le nom de société normalisé :
//   - "Clients"          : base. Statut, AE / AM / CSM, Billed 2025, Target
//                          2026, Billed 2026, % atteinte, facturé Q1-Q4.
//   - "Budget vs Actual" : écart et TARGETS trimestriels (Target Qn).
//   - "Targets"          : target actualisé (révision en cours d'année).
//   - "YoY 2025 vs 2026" : croissance YoY et statut YoY calculé par le sheet
//                          (Expansion, Contraction, Churned, New, In wait,
//                          Inactive).
// Vérifié le 2026-10-02 : Target 2026 / Billed 2026 identiques entre Clients
// et Budget vs Actual (ex. ENEDIS 300 000 / 220 685).
//
// Best-effort : un onglet secondaire illisible laisse ses champs à null et
// produit un warning, seul l'onglet Clients est indispensable.
// ────────────────────────────────────────────────────────────────────────

import { sheetGrid, norm } from "./drive-xlsx";
import { cellNumber, cellText, findHeader, getRevenueWorkbook } from "./revenue-workbook";

export type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

export type ClientTarget = {
  company: string;
  status: string | null; // Renew / New / En attente (statut commercial du sheet)
  ae: string | null;
  am: string | null;
  csm: string | null;
  billed2025: number | null;
  target2026: number | null;
  targetUpdated: number | null; // "Target actualisé" (onglet Targets)
  billed2026: number | null;
  gap: number | null; // billed - target (négatif = en retard)
  achievement: number | null; // billed / target, fraction (1.06 = 106 %)
  quarters: { quarter: Quarter; target: number | null; billed: number | null }[];
  yoyGrowth: number | null; // fraction (0.83 = +83 %)
  yoyStatus: string | null;
};

export type ClientTargetsResult =
  | { ok: true; clients: ClientTarget[]; warnings: string[] }
  | { ok: false; error: string };

const isCompanyRow = (name: string | null): name is string =>
  !!name && !/^(total|client|company)\b/i.test(name);

export async function fetchClientTargets(): Promise<ClientTargetsResult> {
  try {
    const wb = await getRevenueWorkbook();
    const warnings: string[] = [];

    // ── Base : onglet Clients ──
    const cGrid = sheetGrid(wb, "Clients");
    const cHead = findHeader(cGrid, ["company", "statut", "target 2026", "billed 2026"]);
    if (!cHead) return { ok: false, error: `Onglet "Clients" introuvable ou en-tête inattendu (onglets : ${wb.SheetNames.join(", ")}).` };
    const c = cHead.col;
    const byKey = new Map<string, ClientTarget>();
    for (const row of cGrid.slice(cHead.row + 1)) {
      const company = cellText(row[c("company")]);
      if (!isCompanyRow(company)) continue;
      byKey.set(norm(company), {
        company,
        status: cellText(row[c("statut")]),
        ae: cellText(row[c("ae / owner")] ?? row[c("ae")]),
        am: cellText(row[c("am")]),
        csm: cellText(row[c("csm")]),
        billed2025: cellNumber(row[c("billed 2025")]),
        target2026: cellNumber(row[c("target 2026")]),
        targetUpdated: null,
        billed2026: cellNumber(row[c("billed 2026")]),
        gap: null,
        achievement: cellNumber(row[c("% atteinte")]),
        quarters: QUARTERS.map((q) => ({ quarter: q, target: null, billed: cellNumber(row[c(`${q.toLowerCase()} facture`)]) })),
        yoyGrowth: null,
        yoyStatus: null,
      });
    }

    // ── Budget vs Actual : écart + targets trimestriels ──
    const bGrid = sheetGrid(wb, "Budget vs Actual");
    const bHead = findHeader(bGrid, ["client", "target 2026", "facture 2026"]);
    if (!bHead) warnings.push('Onglet "Budget vs Actual" illisible : targets trimestriels indisponibles.');
    else {
      const b = bHead.col;
      for (const row of bGrid.slice(bHead.row + 1)) {
        const t = byKey.get(norm(cellText(row[b("client")])));
        if (!t) continue;
        const ecart = cellNumber(row[b("ecart")]);
        if (ecart != null) t.gap = ecart;
        for (const q of t.quarters) {
          q.target = cellNumber(row[b(`target ${q.quarter.toLowerCase()}`)]);
          q.billed ??= cellNumber(row[b(`facture ${q.quarter.toLowerCase()}`)]);
        }
      }
    }

    // ── Targets : target actualisé ──
    const tGrid = sheetGrid(wb, "Targets");
    const tHead = findHeader(tGrid, ["company", "target 2026", "target actualise"]);
    if (!tHead) warnings.push('Onglet "Targets" illisible : target actualisé indisponible.');
    else {
      const tc = tHead.col;
      for (const row of tGrid.slice(tHead.row + 1)) {
        const t = byKey.get(norm(cellText(row[tc("company")])));
        if (t) t.targetUpdated = cellNumber(row[tc("target actualise")]);
      }
    }

    // ── YoY : croissance + statut ──
    const yGrid = sheetGrid(wb, "YoY 2025 vs 2026");
    const yHead = findHeader(yGrid, ["client", "croissance yoy", "statut"]);
    if (!yHead) warnings.push('Onglet "YoY 2025 vs 2026" illisible : statut YoY indisponible.');
    else {
      const y = yHead.col;
      for (const row of yGrid.slice(yHead.row + 1)) {
        const t = byKey.get(norm(cellText(row[y("client")])));
        if (!t) continue;
        t.yoyGrowth = cellNumber(row[y("croissance yoy")]);
        t.yoyStatus = cellText(row[y("statut")]);
      }
    }

    for (const t of byKey.values()) {
      if (t.gap == null && t.billed2026 != null && t.target2026 != null) t.gap = t.billed2026 - t.target2026;
      if (t.achievement == null && t.billed2026 != null && t.target2026) t.achievement = t.billed2026 / t.target2026;
    }
    return { ok: true, clients: [...byKey.values()], warnings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

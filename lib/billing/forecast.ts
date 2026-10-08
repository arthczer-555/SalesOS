// ────────────────────────────────────────────────────────────────────────
// Prévisionnel 2026, lu dans le classeur revenue :
//   - "Forecast" : synthèse par trimestre (prévu vs facturé) pour le Renew, le
//     New biz pondéré par AE et le total, puis "DÉTAIL DES DEALS NEW BIZ"
//     (AE, société, proba, trimestre, montant, pondéré, statut, commentaire).
//   - "Copy weekly sales team Qn" : la revue weekly des sales du trimestre,
//     par AE (société, commentaire, modalité Human/Hybrid, type Direct/RFP,
//     proba, mois visé, montant).
// ────────────────────────────────────────────────────────────────────────

import { sheetGrid, norm } from "./drive-xlsx";
import { cellNumber, cellText, findHeader, getRevenueWorkbook } from "./revenue-workbook";
import type { Quarter } from "./client-targets";

const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

export type ForecastLine = {
  label: string;
  quarters: { quarter: Quarter; forecast: number | null; billed: number | null }[];
  total: number | null;
};

export type ForecastDeal = {
  ae: string | null;
  company: string;
  probability: number | null; // 0-1
  quarter: string | null;
  amount: number | null;
  weighted: number | null;
  status: string | null;
  comment: string | null;
};

export type WeeklyDeal = {
  ae: string | null;
  company: string;
  comment: string | null;
  dealScoring: string | null;
  modality: string | null;
  type: string | null;
  probability: number | null;
  timing: string | null;
  amount: number | null;
};

export type ForecastResult =
  | { ok: true; lines: ForecastLine[]; deals: ForecastDeal[] }
  | { ok: false; error: string };

export async function fetchForecast(): Promise<ForecastResult> {
  try {
    const wb = await getRevenueWorkbook();
    const grid = sheetGrid(wb, "Forecast");
    if (grid.length === 0) return { ok: false, error: `Onglet "Forecast" introuvable (onglets : ${wb.SheetNames.join(", ")}).` };

    // Synthèse : en-tête "| Q1 | Facturé | Q2 | Facturé | … | Total 2026".
    const lines: ForecastLine[] = [];
    const sHead = findHeader(grid, ["q1", "q2", "q3", "q4"]);
    if (sHead) {
      // Array.from : les lignes XLSX sont des tableaux à trous, map les conserve.
      const cells = Array.from(grid[sHead.row] ?? [], norm);
      const totalCol = cells.findIndex((c) => c.startsWith("total"));
      for (const row of grid.slice(sHead.row + 1)) {
        const label = cellText(row[0]);
        if (!label) continue;
        if (/^detail des deals/i.test(norm(label))) break;
        if (/^cumul/i.test(norm(label))) continue;
        lines.push({
          label,
          quarters: QUARTERS.map((q) => {
            const i = sHead.col(q.toLowerCase());
            return { quarter: q, forecast: cellNumber(row[i]), billed: i >= 0 ? cellNumber(row[i + 1]) : null };
          }),
          total: totalCol >= 0 ? cellNumber(row[totalCol]) : null,
        });
      }
    }

    // Détail des deals new biz.
    const deals: ForecastDeal[] = [];
    const dHead = findHeader(grid, ["ae", "societe", "proba", "trimestre", "montant"], 40);
    if (dHead) {
      const d = dHead.col;
      for (const row of grid.slice(dHead.row + 1)) {
        const company = cellText(row[d("societe")]);
        if (!company) continue;
        deals.push({
          ae: cellText(row[d("ae")]),
          company,
          probability: cellNumber(row[d("proba")]),
          quarter: cellText(row[d("trimestre")]),
          amount: cellNumber(row[d("montant")]),
          weighted: cellNumber(row[d("pondere")]),
          status: cellText(row[d("statut")]),
          comment: cellText(row[d("commentaire")]),
        });
      }
    }

    if (lines.length === 0 && deals.length === 0) return { ok: false, error: 'Onglet "Forecast" illisible (en-têtes attendus introuvables).' };
    return { ok: true, lines, deals };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Revue weekly des sales d'un trimestre ("Copy weekly sales team Qn"), un bloc par AE. */
export async function fetchWeeklyForecast(quarter: Quarter): Promise<{ ok: true; tab: string; deals: WeeklyDeal[] } | { ok: false; error: string }> {
  try {
    const wb = await getRevenueWorkbook();
    const tab = wb.SheetNames.find((n) => norm(n) === `copy weekly sales team ${quarter.toLowerCase()}`);
    if (!tab) return { ok: false, error: `Pas d'onglet "Copy weekly sales team ${quarter}" dans le classeur.` };
    const grid = sheetGrid(wb, tab);
    const deals: WeeklyDeal[] = [];
    let ae: string | null = null;
    let cols: ((label: string) => number) | null = null;
    for (let i = 0; i < grid.length; i++) {
      const row = grid[i] ?? [];
      const cells = Array.from(row, norm);
      if (cells.includes("companies")) {
        // Le nom de l'AE est sur la dernière ligne non vide au-dessus de l'en-tête.
        for (let j = i - 1; j >= 0; j--) {
          const label = (grid[j] ?? []).map(cellText).find(Boolean);
          if (label) {
            ae = label;
            break;
          }
        }
        cols = (label: string) => cells.indexOf(label);
        continue;
      }
      if (!cols) continue;
      const company = cellText(row[cols("companies")]);
      if (!company) continue;
      if (/^total/i.test(company)) {
        cols = null;
        continue;
      }
      deals.push({
        ae,
        company,
        comment: cellText(row[cols("comments")]),
        dealScoring: cellText(row[cols("deal scoring")]),
        modality: cellText(row[cols("modality")]),
        type: cellText(row[cols("type")]),
        probability: cellNumber(row[cols("forecast")]),
        timing: cellText(row[cols("timing")]),
        amount: cellNumber(row[cols("€")]),
      });
    }
    return { ok: true, tab, deals };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

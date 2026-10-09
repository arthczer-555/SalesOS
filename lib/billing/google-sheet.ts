import * as XLSX from "xlsx";
import { downloadWorkbook } from "./drive-xlsx";
import type { Billing } from "../clients/types";

// Contexte facturation depuis l'onglet "Historique" du fichier revenue
// (Google Drive xlsx). Une ligne par société :
//   Company | RFP | Total | Revenue 2022 | ... | Revenue 2026
// Lecture via l'OAuth Google existant (GOOGLE_DRIVE_REFRESH_TOKEN), download
// Drive + parsing xlsx (lib déjà installée). Pas de service account.
//
// Best-effort partout : si l'env manque, si Drive est down, ou si aucune ligne
// ne matche, on renvoie { matched: false } et on ne throw jamais dans le
// pipeline d'enrichissement.

export type BillingRow = {
  company: string;
  isRfp: boolean;
  total: number | null;
  revenueByYear: Record<string, number>;
};

// "€511,165" / "€0" / 0 / "" -> nombre (ou null). Retire €, espaces (y compris
// insécables) et séparateurs de milliers.
function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[€\s ]/g, "").replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export async function fetchBillingRows(): Promise<BillingRow[]> {
  const fileId = process.env.BILLING_DRIVE_FILE_ID;
  if (!fileId) {
    console.warn("[billing] BILLING_DRIVE_FILE_ID manquant — billing skipped");
    return [];
  }
  const tabName = process.env.BILLING_SHEET_TAB || "Historique";

  const wb = await downloadWorkbook(fileId);
  const sheet = wb.Sheets[tabName];
  if (!sheet) {
    console.warn(`[billing] onglet "${tabName}" introuvable (onglets: ${wb.SheetNames.join(", ")})`);
    return [];
  }

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });

  // Trouve la ligne d'en-tête (contient "Company" et "Total"), robuste aux
  // colonnes/lignes vides en tête de feuille.
  const headerRowIdx = grid.findIndex(
    (r) =>
      Array.isArray(r) &&
      r.some((c) => String(c ?? "").trim().toLowerCase() === "company") &&
      r.some((c) => String(c ?? "").trim().toLowerCase() === "total"),
  );
  if (headerRowIdx === -1) {
    console.warn(`[billing] ligne d'en-tête introuvable dans l'onglet "${tabName}"`);
    return [];
  }

  const header = (grid[headerRowIdx] as unknown[]).map((c) => String(c ?? "").trim());
  const col = (name: string) =>
    header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const companyCol = col("Company");
  const rfpCol = col("RFP");
  const totalCol = col("Total");
  const yearCols: Array<{ year: string; idx: number }> = [];
  header.forEach((h, idx) => {
    const m = /^revenue\s+(\d{4})$/i.exec(h);
    if (m) yearCols.push({ year: m[1], idx });
  });

  const rows: BillingRow[] = [];
  for (let i = headerRowIdx + 1; i < grid.length; i++) {
    const r = grid[i] as unknown[];
    if (!Array.isArray(r)) continue;
    const company = String(r[companyCol] ?? "").trim();
    if (!company) continue;

    const revenueByYear: Record<string, number> = {};
    for (const { year, idx } of yearCols) {
      const v = parseAmount(r[idx]);
      if (v != null) revenueByYear[year] = v;
    }

    rows.push({
      company,
      isRfp: String(r[rfpCol] ?? "").trim().toLowerCase() === "yes",
      total: parseAmount(r[totalCol]),
      revenueByYear,
    });
  }

  return rows;
}

// Normalise un nom de société pour le match : majuscules, sans accents, sans
// ponctuation, espaces compactés.
export function normalizeCompany(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findBillingRow(rows: BillingRow[], companyName: string): BillingRow | null {
  if (!companyName.trim()) return null;
  const target = normalizeCompany(companyName);
  let hit = rows.find((r) => normalizeCompany(r.company) === target);
  // Fallback : l'un est préfixe de l'autre (ex: "ASCENTIAL" vs "ASCENTIAL (INFORMA)").
  if (!hit) {
    hit = rows.find((r) => {
      const n = normalizeCompany(r.company);
      return n.startsWith(target) || target.startsWith(n);
    });
  }
  return hit ?? null;
}

// Un nom ou plusieurs (fiche fusionnée : son nom + ceux des fiches absorbées,
// cf. lib/clients/merge.ts). Plusieurs lignes distinctes du sheet = un seul
// compte, leurs montants sont additionnés ; deux noms qui tombent sur la même
// ligne ne la comptent qu'une fois.
export function matchBillingRow(rows: BillingRow[], companyName: string | readonly string[]): Billing {
  const names = typeof companyName === "string" ? [companyName] : companyName;
  const hits = new Map<string, BillingRow>();
  for (const name of names) {
    const hit = findBillingRow(rows, name);
    if (hit && !hits.has(hit.company)) hits.set(hit.company, hit);
  }
  if (hits.size === 0) return { matched: false, match_source: "name" };
  return { ...sumBillingRows([...hits.values()]), match_source: "name" };
}

// Lignes reliées à la main depuis la fiche (clients.billing_sheet_rows, cf.
// lib/clients/billing-link.ts) : match exact (normalisé) sur la colonne
// Company, sans repli par préfixe. Une ligne renommée ou supprimée du sheet
// est listée dans missing_rows, jamais ignorée en silence ; si aucune n'est
// trouvée, matched: false.
export function matchLinkedBillingRows(rows: BillingRow[], linked: readonly string[]): Billing {
  const byName = new Map(rows.map((r) => [normalizeCompany(r.company), r]));
  const found = new Map<string, BillingRow>();
  const missing: string[] = [];
  for (const name of linked) {
    const hit = byName.get(normalizeCompany(name));
    if (hit) found.set(hit.company, hit);
    else missing.push(name);
  }
  const extra = { match_source: "manual" as const, ...(missing.length ? { missing_rows: missing } : {}) };
  if (found.size === 0) return { matched: false, ...extra };
  return { ...sumBillingRows([...found.values()]), ...extra };
}

// Un compte = une ou plusieurs lignes du sheet, montants additionnés.
function sumBillingRows(list: BillingRow[]): Billing {
  const revenueByYear: Record<string, number> = {};
  for (const r of list) {
    for (const [year, v] of Object.entries(r.revenueByYear)) revenueByYear[year] = (revenueByYear[year] ?? 0) + v;
  }
  const totals = list.map((r) => r.total).filter((t): t is number => t != null);

  const currentYear = String(new Date().getFullYear());
  const prevYear = String(new Date().getFullYear() - 1);
  const current = revenueByYear[currentYear] ?? null;
  const prev = revenueByYear[prevYear] ?? null;
  const yoy = current != null && prev != null && prev !== 0 ? (current - prev) / prev : null;

  return {
    matched: true,
    match_key: list.map((r) => r.company).join(" + "),
    matched_rows: list.map((r) => r.company),
    total_contract_value: totals.length ? totals.reduce((s, t) => s + t, 0) : null,
    revenue_by_year: revenueByYear,
    current_year_revenue: current,
    prev_year_revenue: prev,
    yoy_growth: yoy,
    is_rfp: list.some((r) => r.isRfp),
  };
}

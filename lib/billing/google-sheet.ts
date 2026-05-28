import * as XLSX from "xlsx";
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

let _driveAccessToken: string | null = null;
let _driveTokenExpiry = 0;

async function getDriveAccessToken(): Promise<string> {
  if (_driveAccessToken && Date.now() < _driveTokenExpiry) return _driveAccessToken;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("GOOGLE_DRIVE_REFRESH_TOKEN manquant");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Refresh token Drive échoué (${res.status}): ${errBody.slice(0, 120)}`);
  }
  const { access_token, expires_in } = await res.json();
  _driveAccessToken = access_token;
  _driveTokenExpiry = Date.now() + ((expires_in ?? 3600) - 60) * 1000;
  return access_token;
}

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

  const token = await getDriveAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Drive download ${res.status}: ${t.slice(0, 120)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
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
function normalizeCompany(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchBillingRow(rows: BillingRow[], companyName: string): Billing {
  if (!companyName.trim() || rows.length === 0) return { matched: false };

  const target = normalizeCompany(companyName);
  let hit = rows.find((r) => normalizeCompany(r.company) === target);
  // Fallback : l'un est préfixe de l'autre (ex: "ASCENTIAL" vs "ASCENTIAL (INFORMA)").
  if (!hit) {
    hit = rows.find((r) => {
      const n = normalizeCompany(r.company);
      return n.startsWith(target) || target.startsWith(n);
    });
  }
  if (!hit) return { matched: false };

  const currentYear = String(new Date().getFullYear());
  const prevYear = String(new Date().getFullYear() - 1);
  const current = hit.revenueByYear[currentYear] ?? null;
  const prev = hit.revenueByYear[prevYear] ?? null;
  const yoy = current != null && prev != null && prev !== 0 ? (current - prev) / prev : null;

  return {
    matched: true,
    match_key: hit.company,
    total_contract_value: hit.total,
    revenue_by_year: hit.revenueByYear,
    current_year_revenue: current,
    prev_year_revenue: prev,
    yoy_growth: yoy,
    is_rfp: hit.isRfp,
  };
}

// Convenience pour un seul client (enrichissement) : download + match.
export async function getBillingForClient(companyName: string): Promise<Billing> {
  try {
    const rows = await fetchBillingRows();
    return matchBillingRow(rows, companyName);
  } catch (e) {
    console.warn(`[billing] getBillingForClient failed for "${companyName}":`, e instanceof Error ? e.message : e);
    return { matched: false };
  }
}

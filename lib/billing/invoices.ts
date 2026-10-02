// ────────────────────────────────────────────────────────────────────────
// Lecture de l'onglet "Factures" du classeur "Dashboard revenue 2026 .xlsx" :
// une ligne par facture (société, type, montant, part SaaS, date, AE/AM/CSM,
// statut). Seule source du facturé à une granularité plus fine que le
// trimestre (semaine, mois, entre deux dates) et du détail facture par facture.
//
// Conventions vérifiées sur le classeur le 2026-10-02 :
//   - Facturé = statut New + Renew. Le total 2026 de cet onglet (869 932 New +
//     1 061 170 Renew = 1 931 102 €) est exactement le "facturé 2026" de
//     l'onglet Revenue par Trimestre (get_revenue_kpis) : les deux outils
//     donnent donc le même chiffre. "En attente" est compté à part.
//   - "Solde" = montant de la facture. "Solde SaaS" en est la PART SaaS (égale
//     au solde pour une facture AI) : elle ne s'additionne pas au solde.
//   - Les lignes 2025 sont des totaux annuels par client, toutes datées du
//     31/12/2025 : aucune analyse infra-annuelle n'est possible avant 2026.
//
// Parsing par libellés d'en-tête (jamais par position). Best-effort : renvoie
// { ok: false } sur onglet absent ou illisible, ne throw jamais vers l'appelant.
// ────────────────────────────────────────────────────────────────────────

import { downloadWorkbook, sheetGrid, parseAmount, norm } from "./drive-xlsx";

const DEFAULT_FILE_ID = "1zjB-phoCampmQOFNwwiYnw6jwjvrfwmb";
const TAB = "Factures";
// Un agent ou une question peut appeler l'outil plusieurs fois avec des
// filtres différents : un téléchargement du classeur par minute suffit.
const CACHE_MS = 60_000;

export type InvoiceStatus = "new" | "renew" | "pending" | "other";

export type Invoice = {
  company: string;
  type: string | null;
  amount: number;
  saasAmount: number;
  date: string; // YYYY-MM-DD
  year: number | null;
  quarter: number | null;
  ae: string | null;
  am: string | null;
  csm: string | null;
  status: InvoiceStatus;
  statusLabel: string;
};

export type InvoicesResult =
  | { ok: true; invoices: Invoice[]; firstDate: string | null; lastDate: string | null }
  | { ok: false; error: string };

let cache: { at: number; data: InvoicesResult } | null = null;

/** Date de cellule : numéro de série Excel, Date, "jj/mm/aaaa" ou ISO. */
function cellDate(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10);
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const s = v.trim();
    const fr = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (fr) return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  return null;
}

function cellText(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s && s !== "/" && s !== "-" ? s : null;
}

function toStatus(label: string): InvoiceStatus {
  const n = norm(label);
  if (n === "new") return "new";
  if (n === "renew") return "renew";
  if (n.startsWith("en attente") || n === "pending") return "pending";
  return "other";
}

async function load(): Promise<InvoicesResult> {
  try {
    const wb = await downloadWorkbook(process.env.AE_REVENUE_DRIVE_FILE_ID || DEFAULT_FILE_ID);
    const grid = sheetGrid(wb, TAB);
    if (grid.length === 0) return { ok: false, error: `Onglet "${TAB}" introuvable ou vide (onglets : ${wb.SheetNames.join(", ")}).` };

    const headerIdx = grid.findIndex((r) => {
      const cells = r.map(norm);
      return cells.includes("company") && cells.includes("date") && cells.includes("solde");
    });
    if (headerIdx < 0) return { ok: false, error: `En-tête de l'onglet "${TAB}" introuvable (colonnes Company / Solde / Date attendues).` };
    const header = grid[headerIdx].map(norm);
    const col = (name: string) => header.indexOf(name);
    const c = {
      company: col("company"),
      type: col("type"),
      saas: col("solde saas"),
      amount: col("solde"),
      date: col("date"),
      year: col("year"),
      quarter: col("quarter"),
      ae: col("ae"),
      am: col("am"),
      csm: col("csm"),
      status: col("statut"),
    };

    const invoices: Invoice[] = [];
    for (const row of grid.slice(headerIdx + 1)) {
      const company = cellText(row[c.company]);
      const date = cellDate(row[c.date]);
      const amount = parseAmount(row[c.amount]);
      if (!company || !date || amount == null) continue;
      const statusLabel = c.status >= 0 ? String(row[c.status] ?? "").trim() : "";
      invoices.push({
        company,
        type: c.type >= 0 ? cellText(row[c.type]) : null,
        amount,
        saasAmount: c.saas >= 0 ? (parseAmount(row[c.saas]) ?? 0) : 0,
        date,
        year: c.year >= 0 ? (parseAmount(row[c.year]) ?? null) : null,
        quarter: c.quarter >= 0 ? (parseAmount(row[c.quarter]) ?? null) : null,
        ae: c.ae >= 0 ? cellText(row[c.ae]) : null,
        am: c.am >= 0 ? cellText(row[c.am]) : null,
        csm: c.csm >= 0 ? cellText(row[c.csm]) : null,
        status: toStatus(statusLabel),
        statusLabel,
      });
    }
    const dates = invoices.map((i) => i.date).sort();
    return { ok: true, invoices, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchInvoices(): Promise<InvoicesResult> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const data = await load();
  // On ne garde pas une erreur en cache : le prochain appel retente.
  if (data.ok) cache = { at: Date.now(), data };
  return data;
}

/** Facturé au sens du classeur : New + Renew. */
export function isBilled(i: Invoice): boolean {
  return i.status === "new" || i.status === "renew";
}

// ────────────────────────────────────────────────────────────────────────
// Ingestion du revenu facturé + objectifs par AE depuis le Google Drive
// "Dashboard revenue 2026 .xlsx" (source de vérité business, pas HubSpot).
//
// Le montant des deals HubSpot est peu fiable : le "facturé" du Sheet est la
// vraie donnée. On lit via l'OAuth Google existant (GOOGLE_DRIVE_REFRESH_TOKEN),
// download Drive + parsing xlsx (lib `xlsx` déjà installée), même pattern que
// lib/billing/google-sheet.ts.
//
// Parsing par LIBELLÉS de tables (jamais par coordonnées de cellules) pour
// survivre aux changements de mise en page. Best-effort : si l'env manque, si
// Drive est down ou si le format a bougé, on renvoie { ok:false } sans throw.
// ────────────────────────────────────────────────────────────────────────

import * as XLSX from "xlsx";
import {
  emptyRevenueStream,
  type AccountRevenue,
  type QuarterAmount,
  type RevenueStream,
} from "./types";

// Fichier "Dashboard revenue 2026 .xlsx" (partagé, mis à jour en continu).
// Surchargagle via env si le fichier de référence change.
const DEFAULT_FILE_ID = "1zjB-phoCampmQOFNwwiYnw6jwjvrfwmb";

// Les 3 onglets de suivi ont la MÊME structure (bloc de perf par rep + bloc
// "DÉTAIL DES DEALS"), seuls les libellés de colonnes changent.
type StreamKey = "newBiz" | "renew" | "csmRenew";

export type RepRevenue = {
  newBiz: RevenueStream;
  renew: RevenueStream;
  csmRenew: RevenueStream;
};

export type RevenueSheet = {
  ok: boolean;
  byRep: Map<string, RepRevenue>; // clé = prénom normalisé
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

// "400,000 €" / "€0" / 0 / "" → nombre (ou null).
function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[€\s ]/g, "").replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Normalise une cellule texte : sans accents, minuscule, espaces compactés.
function norm(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Clé rep = prénom normalisé (le Sheet utilise les prénoms : "Baptiste",
// "Mehdi"…). On matche donc sur le 1er token du nom SalesOS.
export function repKeyFromName(name: string | null | undefined): string {
  const first = norm(name).split(" ")[0] ?? "";
  return first;
}

type Grid = unknown[][];

function sheetGrid(wb: XLSX.WorkBook, name: string): Grid {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false }) as Grid;
}

// Ligne "TOTAL" ou vide → fin d'un bloc AE.
function isRepRowEnd(cell: unknown): boolean {
  const n = norm(cell);
  return n === "" || n === "total";
}

/** Colonnes "Obj Qn" / "Facturé Qn" d'une ligne d'en-tête normalisée. */
function quarterCols(header: string[]): { obj: Record<number, number>; fac: Record<number, number> } {
  const obj: Record<number, number> = {};
  const fac: Record<number, number> = {};
  header.forEach((h, i) => {
    const mo = /^obj q([1-4])/.exec(h);
    if (mo) obj[Number(mo[1])] = i;
    const mf = /^facture q([1-4])/.exec(h);
    if (mf) fac[Number(mf[1])] = i;
  });
  return { obj, fac };
}

/**
 * Bloc de performance d'un onglet "Suivi *" :
 * `AE | <target> | <billed> | % Atteinte | Obj Q1 | Facturé Q1 | … | Facturé Q4`
 * puis une ligne par rep jusqu'à "TOTAL" ou une ligne vide.
 *
 * Le libellé de la colonne rep est toujours "AE", y compris dans les onglets
 * Renew et CSM où il désigne en réalité l'AM ou le CSM.
 */
function parsePerfBlock(
  grid: Grid,
  targetLabel: string,
  billedLabel: string,
): Map<string, Pick<RevenueStream, "target" | "billed" | "quarters">> {
  const out = new Map<string, Pick<RevenueStream, "target" | "billed" | "quarters">>();
  const headerIdx = grid.findIndex(
    (r) => Array.isArray(r) && r.some((c) => norm(c) === "ae") && r.some((c) => norm(c).includes(targetLabel)),
  );
  if (headerIdx === -1) return out;

  const header = grid[headerIdx].map((c) => norm(c));
  const aeCol = header.findIndex((h) => h === "ae");
  const targetCol = header.findIndex((h) => h.includes(targetLabel));
  const billedCol = header.findIndex((h) => h.includes(billedLabel));
  const { obj, fac } = quarterCols(header);

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!Array.isArray(r)) continue;
    if (isRepRowEnd(r[aeCol])) break;
    const key = repKeyFromName(String(r[aeCol]));
    if (!key) continue;
    out.set(key, {
      target: targetCol >= 0 ? parseAmount(r[targetCol]) : null,
      billed: billedCol >= 0 ? parseAmount(r[billedCol]) : null,
      quarters: ([1, 2, 3, 4] as const).map((q) => ({
        quarter: `Q${q}` as QuarterAmount["quarter"],
        target: obj[q] != null ? parseAmount(r[obj[q]]) : null,
        billed: fac[q] != null ? parseAmount(r[fac[q]]) : null,
      })),
    });
  }
  return out;
}

/**
 * Bloc "DÉTAIL DES DEALS" : `Company | AE|AM|CSM | … | Billed 2026`.
 *
 * On cible ce premier bloc, le seul à porter le nom du rep en colonne et un
 * libellé "Billed 2026". Les blocs suivants de la même ligne (un par rep, avec
 * un simple "Billed") sont redondants.
 */
function parseAccountsBlock(grid: Grid): Map<string, AccountRevenue[]> {
  const out = new Map<string, AccountRevenue[]>();
  const headerIdx = grid.findIndex(
    (r) =>
      Array.isArray(r) && r.some((c) => norm(c) === "company") && r.some((c) => norm(c) === "billed 2026"),
  );
  if (headerIdx === -1) return out;

  const header = grid[headerIdx].map((c) => norm(c));
  const companyCol = header.findIndex((h) => h === "company");
  const billedCol = header.findIndex((h) => h === "billed 2026");
  const ownerCol = header.findIndex(
    (h, i) => i > companyCol && (h === "ae" || h === "am" || h === "csm"),
  );
  if (companyCol === -1 || billedCol === -1 || ownerCol === -1) return out;

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!Array.isArray(r)) continue;
    const company = String(r[companyCol] ?? "").trim();
    if (!company) break; // fin du bloc
    const key = repKeyFromName(String(r[ownerCol]));
    const billed = parseAmount(r[billedCol]);
    if (!key || billed == null) continue;
    out.set(key, (out.get(key) ?? []).concat({ company, billed }));
  }
  for (const list of out.values()) list.sort((a, b) => b.billed - a.billed);
  return out;
}

/**
 * Identifie le flux porté par un onglet à partir de ses libellés de colonnes
 * (et non de son nom, qui peut être renommé) : "objectif new" → New,
 * "target renew" → Renew, que l'onglet distingue AM et CSM par son titre.
 */
function detectStream(sheetName: string, grid: Grid): StreamKey | null {
  const hasLabel = (needle: string): boolean =>
    grid.some((r) => Array.isArray(r) && r.some((c) => norm(c).includes(needle)));

  if (hasLabel("objectif new")) return "newBiz";
  if (!hasLabel("target renew")) return null;
  // "par csm" figure dans le titre du bloc ; le nom d'onglet sert de filet.
  const isCsm = hasLabel("par csm") || norm(sheetName).includes("csm");
  return isCsm ? "csmRenew" : "renew";
}

function emptyRepRevenue(): RepRevenue {
  return {
    newBiz: emptyRevenueStream(),
    renew: emptyRevenueStream(),
    csmRenew: emptyRevenueStream(),
  };
}

const STREAM_LABELS: Record<StreamKey, { target: string; billed: string }> = {
  newBiz: { target: "objectif new", billed: "new facture" },
  renew: { target: "target renew", billed: "renew facture" },
  csmRenew: { target: "target renew", billed: "renew facture" },
};

/**
 * Parcourt les onglets et remplit `byRep`. Renvoie les flux effectivement
 * trouvés, pour distinguer "le Sheet a bougé" de "ce rep n'y figure pas".
 */
function parseWorkbook(wb: XLSX.WorkBook, byRep: Map<string, RepRevenue>): Set<StreamKey> {
  const found = new Set<StreamKey>();

  for (const sheetName of wb.SheetNames) {
    const grid = sheetGrid(wb, sheetName);
    if (grid.length === 0) continue;
    const stream = detectStream(sheetName, grid);
    if (!stream || found.has(stream)) continue;

    const labels = STREAM_LABELS[stream];
    const perf = parsePerfBlock(grid, labels.target, labels.billed);
    if (perf.size === 0) continue;
    const accounts = parseAccountsBlock(grid);

    for (const [key, p] of perf) {
      const rep = byRep.get(key) ?? emptyRepRevenue();
      rep[stream] = { ...p, accounts: accounts.get(key) ?? [] };
      byRep.set(key, rep);
    }
    found.add(stream);
  }

  return found;
}

export async function fetchRevenueSheet(): Promise<RevenueSheet> {
  const fileId = process.env.AE_REVENUE_DRIVE_FILE_ID || DEFAULT_FILE_ID;
  const byRep = new Map<string, RepRevenue>();
  try {
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
    const found = parseWorkbook(wb, byRep);
    // Les onglets Renew/CSM sont best-effort : c'est le New qui conditionne
    // la validité du parsing (c'est la métrique AE de référence).
    if (!found.has("renew")) console.warn("[ae-activity] revenue sheet : bloc Renew introuvable");
    if (!found.has("csmRenew")) console.warn("[ae-activity] revenue sheet : bloc CSM introuvable");
    return { ok: found.has("newBiz") && byRep.size > 0, byRep };
  } catch (e) {
    console.warn("[ae-activity] revenue sheet failed:", e instanceof Error ? e.message : e);
    return { ok: false, byRep };
  }
}

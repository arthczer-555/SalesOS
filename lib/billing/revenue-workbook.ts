// ────────────────────────────────────────────────────────────────────────
// Classeur "Dashboard revenue 2026 .xlsx" partagé par les outils revenue de
// CoachelloAI (factures, objectifs clients, objectifs commerciaux, forecast).
//
// Un seul téléchargement par minute et par process : un agent appelle souvent
// plusieurs outils revenue dans le même tour, en parallèle. Les appels
// simultanés partagent le même téléchargement (inflight).
// ────────────────────────────────────────────────────────────────────────

import type * as XLSX from "xlsx";
import { downloadWorkbook, norm } from "./drive-xlsx";

export const REVENUE_DEFAULT_FILE_ID = "1zjB-phoCampmQOFNwwiYnw6jwjvrfwmb";
const TTL_MS = 60_000;

let cache: { at: number; wb: XLSX.WorkBook } | null = null;
let inflight: Promise<XLSX.WorkBook> | null = null;

export async function getRevenueWorkbook(): Promise<XLSX.WorkBook> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.wb;
  if (!inflight) {
    inflight = downloadWorkbook(process.env.AE_REVENUE_DRIVE_FILE_ID || REVENUE_DEFAULT_FILE_ID)
      .then((wb) => {
        cache = { at: Date.now(), wb };
        return wb;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Ligne d'en-tête d'un onglet : la première (dans les `maxScan` premières)
 * qui contient tous les libellés `required` (normalisés : sans accents,
 * minuscules). `col` renvoie l'index de la PREMIÈRE colonne portant un
 * libellé, -1 sinon. Parsing par libellés, jamais par position : le classeur
 * est retouché à la main.
 */
export function findHeader(
  grid: unknown[][],
  required: string[],
  maxScan = 20,
): { row: number; col: (label: string) => number } | null {
  for (let i = 0; i < Math.min(grid.length, maxScan); i++) {
    const cells = Array.from(grid[i] ?? [], norm);
    if (required.every((r) => cells.includes(r))) {
      return { row: i, col: (label: string) => cells.indexOf(label) };
    }
  }
  return null;
}

/** Nombre d'une cellule ("-", "?", vide, #REF! -> null). */
export function cellNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[€\s  ]/g, "").replace(/,/g, "");
  if (!s || s === "-" || s === "?" || s.startsWith("#")) return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Texte d'une cellule ("/", "-", vide, #REF! -> null). Tirets longs du sheet neutralisés. */
export function cellText(v: unknown): string | null {
  const s = String(v ?? "")
    .replace(/\s*[—–]\s*/g, " - ")
    .trim();
  return s && s !== "/" && s !== "-" && !s.startsWith("#") ? s : null;
}

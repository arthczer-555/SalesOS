/**
 * Bright Data — Web Scraper / Datasets API (collecte asynchrone).
 *
 * Contrairement à la SERP (synchrone, cf serp.ts), les datasets fonctionnent
 * par snapshot : on déclenche un `trigger` (renvoie un snapshot_id), puis on
 * poll `progress` jusqu'à `ready` avant de récupérer les données.
 *
 * Un scrape prend typiquement 10-60s → au-delà de la limite synchrone Netlify
 * (~26s). Deux usages :
 *  - `collectAndWait` avec un timeout court (~20s) → best-effort dans une requête
 *    web (briefing, chat) : renvoie [] si pas prêt à temps.
 *  - `triggerDataset` + `pollSnapshot` avec un gros timeout → pour les Background
 *    Functions (mass-prospection) où on peut attendre plusieurs minutes.
 */

import { reportInsufficientCredit } from "@/lib/credit-alert";
import { InsufficientCreditError, isCreditText } from "@/lib/credit-error";
import { BRIGHTDATA_API_KEY, authHeaders } from "./serp";

const BASE = "https://api.brightdata.com/datasets/v3";

// IDs des datasets LinkedIn accessibles avec la clé (vérifiés via /datasets/list).
export const DATASETS = {
  peopleProfile: process.env.BRIGHTDATA_LINKEDIN_DATASET_ID || "gd_l1viktl72bvl7bjuj0",
  companyInfo: "gd_l1vikfnt1wgvvqz95w",
  posts: "gd_lyy3tktm25m4avu764",
  jobs: "gd_lpfll7v5hcqtkxl6l",
} as const;

export type DiscoverBy =
  | { type: "discover_new"; discoverBy: string }
  | { type: "collect" };

/**
 * Déclenche une collecte. `rows` est le tableau d'entrées (ex: [{url}] pour
 * collect, [{url}] avec discoverBy pour discovery). Renvoie le snapshot_id.
 */
export async function triggerDataset(
  datasetId: string,
  rows: Record<string, unknown>[],
  discover: DiscoverBy = { type: "collect" },
): Promise<string> {
  if (!BRIGHTDATA_API_KEY) throw new Error("BRIGHTDATA_API_KEY manquante");
  const params = new URLSearchParams({ dataset_id: datasetId, include_errors: "true" });
  if (discover.type === "discover_new") {
    params.set("type", "discover_new");
    params.set("discover_by", discover.discoverBy);
  }
  const res = await fetch(`${BASE}/trigger?${params.toString()}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(rows),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 402 || isCreditText(text)) {
      const detail = text.slice(0, 300) || `HTTP ${res.status}`;
      await reportInsufficientCredit({
        provider: "Bright Data",
        detail,
        context: "Bright Data dataset trigger (LinkedIn)",
      });
      throw new InsufficientCreditError("Bright Data", detail);
    }
    throw new Error(`Bright Data trigger ${res.status}: ${text.slice(0, 200)}`);
  }
  let json: { snapshot_id?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Bright Data trigger: réponse inattendue ${text.slice(0, 120)}`);
  }
  if (!json.snapshot_id) throw new Error("Bright Data trigger: snapshot_id absent");
  return json.snapshot_id;
}

export type SnapshotStatus = "running" | "ready" | "failed" | "timeout" | "unknown";

/** État courant d'un snapshot (un seul appel, pas de polling). */
export async function snapshotStatus(snapshotId: string): Promise<SnapshotStatus> {
  const res = await fetch(`${BASE}/progress/${snapshotId}`, { headers: authHeaders() });
  if (!res.ok) return "unknown";
  try {
    const j = (await res.json()) as { status?: string };
    const s = j.status ?? "unknown";
    if (s === "ready") return "ready";
    if (s === "failed") return "failed";
    if (s === "running" || s === "building" || s === "collecting") return "running";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** Récupère les lignes d'un snapshot prêt. */
export async function fetchSnapshot<T = Record<string, unknown>>(snapshotId: string): Promise<T[]> {
  const res = await fetch(`${BASE}/snapshot/${snapshotId}?format=json`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Bright Data snapshot ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : [data]) as T[];
}

/**
 * Poll un snapshot jusqu'à `ready` ou expiration du timeout.
 * Renvoie les lignes, ou `null` si pas prêt à temps / échec (best-effort).
 */
export async function pollSnapshot<T = Record<string, unknown>>(
  snapshotId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T[] | null> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const intervalMs = opts.intervalMs ?? 4_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await snapshotStatus(snapshotId);
    if (status === "ready") return fetchSnapshot<T>(snapshotId);
    if (status === "failed") return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

/**
 * Trigger + poll en une fois (best-effort). Renvoie les lignes ou `[]`
 * (jamais null) : adapté aux contextes synchrones qui veulent dégrader
 * gracieusement quand le scrape est trop lent.
 */
export async function collectAndWait<T = Record<string, unknown>>(
  datasetId: string,
  rows: Record<string, unknown>[],
  opts: { timeoutMs?: number; discover?: DiscoverBy } = {},
): Promise<T[]> {
  try {
    const snapshotId = await triggerDataset(datasetId, rows, opts.discover);
    const result = await pollSnapshot<T>(snapshotId, { timeoutMs: opts.timeoutMs });
    return result ?? [];
  } catch {
    return [];
  }
}

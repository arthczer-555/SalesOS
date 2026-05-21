import { db } from "@/lib/db";
import {
  searchPeople,
  NetrowsNotFoundError,
  NetrowsAuthError,
  NetrowsCreditsError,
  NetrowsRateLimitError,
} from "@/lib/netrows";
import type { ComboLog, EnrichmentProfile, NetrowsCriteria } from "@/lib/intel-types";

// Hard cap on cross-product size. Beyond this we truncate et on remonte
// `capped` à l'UI. 1 combo = 1 appel = 1 crédit Netrows minimum (×N pages).
export const MAX_COMBOS = 250;

// Pages tentées par combo via le param `start` Netrows. Page size = jusqu'à 10
// profils. La pagination est non-déterministe (Netrows peut renvoyer 0 à start=10
// puis des résultats à start=20), donc on tente plusieurs pages mais on capote.
export const MAX_PAGES_PER_COMBO = 5;

// Netrows rate-limit ~50 req/min. Quand on partait en parallèle (CONCURRENCY>1),
// le 2e combo retournait silencieusement 404 (Netrows utilise NOT_FOUND comme
// throttle au lieu d'un 429 honnête). Donc on sériel avec un sleep entre appels.
// Voir aussi app/api/intel/enrich/radar/refresh/route.ts qui applique la même pause.
export const REQUEST_DELAY_MS = 1500;

// Persist progress every PROGRESS_BATCH combos so the UI poller sees movement.
const PROGRESS_BATCH = 1;

type Combo = { company: string | null; title: string | null };

export interface RunNetrowsSearchResult {
  profiles: EnrichmentProfile[];
  total: number;
  combosTotal: number;
  capped: { requested: number; limit: number } | null;
}

export function buildCombos(criteria: NetrowsCriteria): { combos: Combo[]; requested: number; capped: boolean } {
  const companies = (criteria.companies ?? []).filter(Boolean);
  const titles = (criteria.titles ?? []).filter(Boolean);
  const companyList: (string | null)[] = companies.length === 0 ? [null] : companies;
  const titleList: (string | null)[] = titles.length === 0 ? [null] : titles;
  const all = companyList.flatMap((c) => titleList.map((t) => ({ company: c, title: t })));
  return {
    combos: all.slice(0, MAX_COMBOS),
    requested: all.length,
    capped: all.length > MAX_COMBOS,
  };
}

function classifyError(err: unknown): { status: ComboLog["status"]; http_status: number | null; message: string } {
  if (err instanceof NetrowsAuthError) return { status: "auth", http_status: 401, message: err.message };
  if (err instanceof NetrowsCreditsError) return { status: "credits", http_status: 402, message: err.message };
  if (err instanceof NetrowsRateLimitError) return { status: "rate_limit", http_status: 429, message: err.message };
  if (err instanceof NetrowsNotFoundError) return { status: "no_match", http_status: 404, message: err.message };
  const msg = err instanceof Error ? err.message : String(err);
  return { status: "error", http_status: null, message: msg };
}

export async function runNetrowsSearch(jobId: string, criteria: NetrowsCriteria): Promise<void> {
  const { combos, requested, capped } = buildCombos(criteria);
  const keywords = criteria.keywords?.trim() || undefined;
  const sharedExtras = {
    firstName: criteria.firstName?.trim() || undefined,
    lastName: criteria.lastName?.trim() || undefined,
    geo: criteria.geo?.trim() || undefined,
    schoolId: criteria.schoolId?.trim() || undefined,
    keywordSchool: criteria.keywordSchool?.trim() || undefined,
  };

  await db
    .from("netrows_search_jobs")
    .update({
      status: "running",
      combos_total: combos.length,
      capped: capped ? { requested, limit: MAX_COMBOS } : null,
      combo_logs: [],
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  const seen = new Set<string>();
  const profiles: EnrichmentProfile[] = [];
  const comboLogs: ComboLog[] = [];
  let totalCount = 0;
  let done = 0;
  let lastErrorMessage: string | null = null;

  try {
    for (let i = 0; i < combos.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      const c = combos[i];
      const comboStart = Date.now();

      // Paginate jusqu'à MAX_PAGES_PER_COMBO. On stoppe si une page renvoie
      // 0 ET qu'on a déjà au moins 1 item (Netrows peut renvoyer 0 puis +
      // donc on tente quelques pages quand même si on a rien).
      let itemsThisCombo = 0;
      let totalThisCombo = 0;
      let comboError: { status: ComboLog["status"]; http_status: number | null; message: string } | null = null;
      let httpStatus: number | null = 200;

      for (let page = 0; page < MAX_PAGES_PER_COMBO; page++) {
        if (page > 0) await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
        try {
          const r = await searchPeople({
            ...sharedExtras,
            company: c.company ?? undefined,
            keywordTitle: c.title ?? undefined,
            keywords,
            start: page * 10,
          });
          const items = r.data?.items ?? [];
          if (page === 0) totalThisCombo = r.data?.total ?? 0;
          for (const item of items) {
            if (seen.has(item.username)) continue;
            seen.add(item.username);
            const parts = item.fullName.trim().split(/\s+/);
            profiles.push({
              username: item.username,
              fullName: item.fullName,
              firstName: parts[0],
              lastName: parts.slice(1).join(" "),
              headline: item.headline,
              company: c.company,
              profileUrl: item.profileURL,
              source: "netrows-search" as const,
              selected: true,
            });
            itemsThisCombo++;
          }
          // Stop si on a tout récupéré ou si Netrows a renvoyé moins qu'une
          // page pleine ET qu'on a déjà des items (signal "fin").
          if (totalThisCombo > 0 && itemsThisCombo >= totalThisCombo) break;
          if (items.length === 0 && page > 0) break;
        } catch (err) {
          const classified = classifyError(err);
          comboError = classified;
          httpStatus = classified.http_status;
          // 404 sur page 0 = no_match (normal). Sur pages > 0 = juste fin de pagination,
          // on garde ce qu'on a et on s'arrête sans considérer comme erreur.
          if (err instanceof NetrowsNotFoundError && page > 0) {
            comboError = null;
            break;
          }
          // Auth / crédits / rate-limit : on arrête tout, ça ne va pas s'améliorer.
          if (
            err instanceof NetrowsAuthError ||
            err instanceof NetrowsCreditsError ||
            err instanceof NetrowsRateLimitError
          ) {
            console.error(`[netrows-search] hard stop (${classified.status}):`, classified.message);
            lastErrorMessage = classified.message;
            throw err;
          }
          console.error(`[netrows-search] combo failed (company=${c.company ?? "-"}, title=${c.title ?? "-"}):`, classified.message);
          break;
        }
      }

      totalCount += totalThisCombo;
      const log: ComboLog = {
        company: c.company,
        title: c.title,
        status: comboError ? comboError.status : itemsThisCombo > 0 ? "ok" : "no_match",
        http_status: httpStatus,
        items_count: itemsThisCombo,
        error: comboError?.message ?? null,
        duration_ms: Date.now() - comboStart,
      };
      comboLogs.push(log);

      done = i + 1;
      if (done % PROGRESS_BATCH === 0 || done === combos.length) {
        await db
          .from("netrows_search_jobs")
          .update({
            combos_done: done,
            profiles, // mise à jour live pour que le compteur "X profils trouvés" bouge
            combo_logs: comboLogs,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }
    }

    // Job marqué "error" seulement si TOUS les combos ont échoué (hors no_match).
    // no_match (404 Netrows) = réponse normale, pas une erreur.
    const hardFailures = comboLogs.filter((l) => l.status !== "ok" && l.status !== "no_match");
    const allFailedHard = hardFailures.length === combos.length && profiles.length === 0;
    await db
      .from("netrows_search_jobs")
      .update({
        status: allFailedHard ? "error" : "done",
        combos_done: combos.length,
        profiles,
        combo_logs: comboLogs,
        total: totalCount,
        error_message: allFailedHard ? hardFailures[0]?.error ?? "Erreur Netrows" : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  } catch (e) {
    await db
      .from("netrows_search_jobs")
      .update({
        status: "error",
        combos_done: done,
        profiles,
        combo_logs: comboLogs,
        error_message: lastErrorMessage ?? (e instanceof Error ? e.message : "Erreur Netrows"),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    // Hard-stop (auth/credits/rate-limit) ne propage pas, on a déjà tout sauvé.
    if (
      e instanceof NetrowsAuthError ||
      e instanceof NetrowsCreditsError ||
      e instanceof NetrowsRateLimitError
    ) {
      return;
    }
    throw e;
  }
}

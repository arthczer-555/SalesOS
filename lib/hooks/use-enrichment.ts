import useSWR from "swr";
import type { ComboLog, EnrichmentList, EnrichmentProfile, NetrowsCriteria, HubspotCriteria } from "@/lib/intel-types";

interface ListsResponse {
  lists: EnrichmentList[];
}

export function useEnrichmentLists() {
  const { data, error, isLoading, mutate } = useSWR<ListsResponse>("/api/intel/enrich/lists", {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });
  return {
    lists: data?.lists ?? [],
    isLoading,
    error: error ? (error instanceof Error ? error.message : "") : "",
    reload: () => mutate(),
  };
}

export interface NetrowsSearchProgress {
  status: "pending" | "running" | "done" | "error";
  combosTotal: number;
  combosDone: number;
  profiles: EnrichmentProfile[];
  total: number;
  capped: { requested: number; limit: number } | null;
  comboLogs: ComboLog[];
  error: string | null;
}

export async function startNetrowsSearch(
  criteria: NetrowsCriteria,
): Promise<{ jobId: string; combosTotal: number; capped: { requested: number; limit: number } | null }> {
  const r = await fetch("/api/intel/enrich/netrows-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(criteria),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur Netrows");
  return data;
}

export async function getNetrowsSearchProgress(jobId: string): Promise<NetrowsSearchProgress> {
  const r = await fetch(`/api/intel/enrich/netrows-search/${jobId}`);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur polling");
  return data;
}

export async function pollNetrowsSearch(
  jobId: string,
  onProgress?: (p: NetrowsSearchProgress) => void,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<NetrowsSearchProgress> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  const start = Date.now();
  while (true) {
    const p = await getNetrowsSearchProgress(jobId);
    onProgress?.(p);
    if (p.status === "done" || p.status === "error") return p;
    if (Date.now() - start > timeoutMs) throw new Error("Timeout polling Netrows");
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

export async function searchHubspot(
  criteria: HubspotCriteria,
): Promise<{ profiles: EnrichmentProfile[]; skippedByRadar?: number; hasMore?: boolean }> {
  const r = await fetch("/api/intel/enrich/hubspot-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(criteria),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur HubSpot");
  return data;
}

export async function resolveUsernames(profiles: { hubspotId?: string; email?: string; firstName?: string; lastName?: string; company?: string }[]) {
  const r = await fetch("/api/intel/enrich/resolve-username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profiles }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur");
  return data.results as { hubspotId?: string; username: string | null }[];
}

export async function findEmails(usernames: string[]) {
  const r = await fetch("/api/intel/enrich/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur");
  return data.results as { username: string; email: string | null; confidence: string | null }[];
}

export async function addToRadarBulk(profiles: EnrichmentProfile[]) {
  const r = await fetch("/api/intel/enrich/add-to-radar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profiles: profiles.map((p) => ({
        username: p.username ?? null,
        fullName: p.fullName,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        headline: p.headline,
        company: p.company,
        profileUrl: p.profileUrl,
        source: p.source ?? "manual",
        is_champion: p.isChampion === true,
        hubspotId: p.hubspotId ?? null,
      })),
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur");
  return data as {
    added: string[];
    skipped: string[];
    failed: { name: string; error: string }[];
    unresolved: { name: string; reason: string }[];
    resolvedCount: number;
  };
}

export async function removeFromRadar(username: string) {
  const r = await fetch(`/api/intel/enrich/radar/${encodeURIComponent(username)}`, { method: "DELETE" });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur");
  return data;
}

export async function removeFromRadarBulk(usernames: string[]): Promise<{ removed: number }> {
  const r = await fetch("/api/intel/enrich/radar/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur retrait");
  return { removed: typeof data.removed === "number" ? data.removed : usernames.length };
}

export interface RadarRefreshResult {
  updated_count: number;
  updated: string[];
  diffs: {
    username: string;
    fields: { field: "headline" | "company" | "full_name"; old: string | null; new: string | null }[];
  }[];
  errors: { username: string; error: string }[];
  credits_used: number;
  re_resolved: { username: string; email: string; confidence: "high" | "medium" | "low" | null; source: "hubspot" | "netrows" | "cache" }[];
  re_resolve_errors: { username: string; reason: string }[];
}

export async function refreshRadarProfiles(usernames: string[]): Promise<RadarRefreshResult> {
  const r = await fetch("/api/intel/enrich/radar/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur refresh");
  return data;
}

export interface RadarBackfillEmailsResult {
  attempted: number;
  resolved_count: number;
  unresolved_count: number;
  remaining: number;
  resolved: { radar_id: string; username: string; email: string; confidence: "high" | "medium" | "low" | null; source: "hubspot" | "netrows" | "cache" }[];
  unresolved: { radar_id: string; username: string; reason: string }[];
}

export async function resolveMissingRadarEmails(limit = 50): Promise<RadarBackfillEmailsResult> {
  const r = await fetch("/api/intel/enrich/radar/resolve-missing-emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur résolution emails");
  return data;
}

export async function saveList(input: {
  id?: string;
  name: string;
  source: "netrows" | "hubspot" | "mixed";
  criteria?: unknown;
  results: EnrichmentProfile[];
}): Promise<EnrichmentList> {
  const r = await fetch("/api/intel/enrich/lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Erreur");
  return data.list as EnrichmentList;
}

export async function deleteList(id: string) {
  const r = await fetch(`/api/intel/enrich/lists/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Suppression échouée");
}

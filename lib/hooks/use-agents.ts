import useSWR from "swr";
import type { AgentDetail, AgentSummary } from "@/lib/agents/types";
import type { SlackChannelOption } from "@/lib/agents/slack";
import type { AudienceUser } from "@/lib/agents/audience-label";

// Fetcher qui remonte les erreurs HTTP (le fetcher global renvoie le JSON
// d'erreur comme une donnée valide).
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export function useAgents() {
  const { data, error, isLoading, mutate } = useSWR<{ mine: AgentSummary[]; team: AgentSummary[] }>("/api/agents", fetchJson, {
    dedupingInterval: 2000,
    revalidateOnFocus: true,
    // Un agent en cours de design : on repolle pour voir sa carte se remplir.
    refreshInterval: (d) => (d?.mine.some((a) => a.design_status === "designing") ? 4000 : 0),
  });
  return { mine: data?.mine ?? [], team: data?.team ?? [], error: error as Error | undefined, isLoading, mutate };
}

/** Design ou run en cours : l'éditeur polle vite pour suivre les étapes. */
export function isAgentBusy(d: AgentDetail | undefined): boolean {
  if (!d) return false;
  return d.agent.design_status === "designing" || d.runs.some((r) => r.status === "queued" || r.status === "running");
}

export function useAgent(id: string) {
  const { data, error, isLoading, mutate } = useSWR<AgentDetail>(`/api/agents/${id}`, fetchJson, {
    dedupingInterval: 0,
    revalidateOnFocus: true,
    refreshInterval: (d) => (isAgentBusy(d) ? 1500 : 0),
  });
  return { data, error: error as Error | undefined, isLoading, mutate };
}

export function useSlackChannels(enabled: boolean) {
  const { data, error, isLoading } = useSWR<{ channels: SlackChannelOption[] }>(enabled ? "/api/agents/slack-channels" : null, fetchJson, {
    dedupingInterval: 5 * 60_000,
  });
  return { channels: data?.channels ?? [], error: error as Error | undefined, isLoading };
}

/** Comptes CoachelloHQ avec leurs rôles : audience d'un agent calculée en direct. */
export function useTeamUsers(enabled: boolean) {
  const { data, error, isLoading } = useSWR<{ users: AudienceUser[] }>(enabled ? "/api/users/list" : null, fetchJson, {
    dedupingInterval: 5 * 60_000,
    revalidateOnFocus: false,
  });
  return { users: data?.users ?? [], error: error as Error | undefined, isLoading };
}

/** POST/PATCH/DELETE JSON avec message d'erreur lisible. */
export async function agentsApi<T = unknown>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

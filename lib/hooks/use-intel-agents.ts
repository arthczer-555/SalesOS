import useSWR from "swr";
import type { Agent } from "@/lib/intel-types";

interface AgentsResponse {
  agents: Agent[];
}

export function useIntelAgents() {
  const { data, error, isLoading, mutate } = useSWR<AgentsResponse>("/api/intel/agents", {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    // Poll toutes les 5s tant qu'un agent est en cours (fire-and-forget)
    refreshInterval: (latest) =>
      latest?.agents.some((a) => a.last_run_status === "running") ? 5_000 : 0,
  });

  return {
    agents: data?.agents ?? [],
    isLoading,
    error: error ? (error instanceof Error ? error.message : "Erreur de chargement") : "",
    reload: () => mutate(),
  };
}

export async function toggleAgent(id: string, enabled: boolean): Promise<void> {
  const res = await fetch(`/api/intel/agents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`Toggle ${id} failed`);
}

export async function runAgent(id: string): Promise<{ ok: boolean; payload?: unknown }> {
  const res = await fetch(`/api/intel/agents/${id}/run`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, payload: data };
}

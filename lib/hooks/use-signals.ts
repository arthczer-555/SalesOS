"use client";

import useSWR from "swr";
import { useCallback } from "react";
import type { SignalRow } from "@/lib/signals/types";

// Fetcher qui throw sur non-2xx (sinon le body d'erreur devient `data`).
// Voir mémoire [[feedback_swr_fetcher_silent_500]].
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type SignalAction = "accept" | "dismiss" | "snooze";

export interface SignalActionResult {
  ok: boolean;
  recipient?: { name: string | null; email: string } | null;
  draft?: { subject: string; body: string } | null;
  apolloUsed?: boolean;
  scopeCompanyId?: string | null;
  error?: string;
}

export function useSignals(params: { owner?: string; type?: string }) {
  const search = new URLSearchParams();
  if (params.owner) search.set("owner", params.owner);
  if (params.type) search.set("type", params.type);
  const qs = search.toString();
  const url = qs ? `/api/signals?${qs}` : "/api/signals";

  const { data, error, isLoading, mutate } = useSWR<{ signals: SignalRow[] }>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
  });

  const act = useCallback(async (id: string, action: SignalAction): Promise<SignalActionResult> => {
    const res = await fetch(`/api/signals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = (await res.json().catch(() => ({}))) as SignalActionResult;
    return { ...json, ok: res.ok && json.ok !== false };
  }, []);

  const refresh = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch("/api/signals/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feed: "both" }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) return { ok: false, error: json.error ?? `HTTP ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    }
  }, []);

  return {
    signals: data?.signals ?? [],
    error: error ? (error as Error).message : null,
    isLoading,
    mutate,
    act,
    refresh,
  };
}

/** Signaux d'un compte (fiche Watch List). */
export function useCompanySignals(companyId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ signals: SignalRow[] }>(
    companyId ? `/api/signals?companyId=${companyId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 15_000 },
  );
  return {
    signals: data?.signals ?? [],
    error: error ? (error as Error).message : null,
    isLoading,
    mutate,
  };
}

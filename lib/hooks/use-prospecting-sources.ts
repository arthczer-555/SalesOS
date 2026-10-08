"use client";

// Appels aux sources de prospects (drawer "Add prospects") : Apollo, HubSpot,
// listes sauvegardées, Watch List, LinkedIn, reveal d'emails.
import useSWR from "swr";
import { useCallback, useRef, useState } from "react";
import { ApiError, fetchJson, sendJson, swrFetcher } from "@/lib/prospecting/client/http";
import type {
  ApolloFilters,
  ApolloSearchResponse,
  HubspotSearchResponse,
  SavedListDetail,
  SavedListSummary,
  WatchAccountItem,
  WatchContactsResponse,
} from "@/lib/prospecting/sources/shared";
import type { JobRow, LeadInput } from "@/lib/prospecting/types";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Apollo ──────────────────────────────────────────────────────────────────

interface ApolloState {
  data: ApolloSearchResponse | null;
  error: string | null;
  /** false = Apollo non configuré sur l'espace (clé absente). */
  configured: boolean;
  isLoading: boolean;
}

export function useApolloSearch() {
  const [state, setState] = useState<ApolloState>({ data: null, error: null, configured: true, isLoading: false });
  const reqId = useRef(0);
  const last = useRef<{ filters: ApolloFilters; page: number } | null>(null);

  const search = useCallback(async (filters: ApolloFilters, page = 1) => {
    const id = ++reqId.current;
    last.current = { filters, page };
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const data = await sendJson<ApolloSearchResponse>("/api/prospecting/sources/apollo/search", "POST", { filters, page });
      if (id === reqId.current) setState({ data, error: null, configured: true, isLoading: false });
    } catch (e) {
      if (id !== reqId.current) return;
      const configured = !(e instanceof ApiError && (e.body as { configured?: boolean } | null)?.configured === false);
      setState((s) => ({ ...s, error: errorText(e), configured, isLoading: false }));
    }
  }, []);

  const retry = useCallback(() => {
    if (last.current) void search(last.current.filters, last.current.page);
  }, [search]);

  const reset = useCallback(() => {
    reqId.current++;
    last.current = null;
    setState({ data: null, error: null, configured: true, isLoading: false });
  }, []);

  return { ...state, search, retry, reset };
}

// ── HubSpot ─────────────────────────────────────────────────────────────────

export interface HubspotFilterParams {
  q?: string;
  owner?: "mine" | "all";
  lifecyclestage?: string;
  contacted?: string;
  leadstatus?: string;
  sort?: string;
}

interface HubspotState {
  data: HubspotSearchResponse | null;
  error: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  mode: "filters" | "ai";
}

function hubspotQuery(p: HubspotFilterParams, after?: string | null): string {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.owner === "all") qs.set("owner", "all");
  if (p.lifecyclestage) qs.set("lifecyclestage", p.lifecyclestage);
  if (p.contacted) qs.set("contacted", p.contacted);
  if (p.leadstatus) qs.set("leadstatus", p.leadstatus);
  if (p.sort) qs.set("sort", p.sort);
  if (after) qs.set("after", after);
  return qs.toString();
}

export function useHubspotSearch() {
  const [state, setState] = useState<HubspotState>({ data: null, error: null, isLoading: false, isLoadingMore: false, mode: "filters" });
  const reqId = useRef(0);
  const last = useRef<{ kind: "filters"; params: HubspotFilterParams } | { kind: "ai"; query: string; owner: "mine" | "all" } | null>(null);

  const search = useCallback(async (params: HubspotFilterParams) => {
    const id = ++reqId.current;
    last.current = { kind: "filters", params };
    setState((s) => ({ ...s, isLoading: true, error: null, mode: "filters" }));
    try {
      const data = await fetchJson<HubspotSearchResponse>(`/api/prospecting/sources/hubspot/search?${hubspotQuery(params)}`);
      if (id === reqId.current) setState({ data, error: null, isLoading: false, isLoadingMore: false, mode: "filters" });
    } catch (e) {
      if (id === reqId.current) setState((s) => ({ ...s, data: null, error: errorText(e), isLoading: false }));
    }
  }, []);

  const loadMore = useCallback(async () => {
    const prev = state.data;
    const l = last.current;
    if (!prev?.nextCursor || !l || l.kind !== "filters") return;
    const id = reqId.current;
    setState((s) => ({ ...s, isLoadingMore: true }));
    try {
      const more = await fetchJson<HubspotSearchResponse>(`/api/prospecting/sources/hubspot/search?${hubspotQuery(l.params, prev.nextCursor)}`);
      if (id !== reqId.current) return;
      setState((s) => ({
        ...s,
        isLoadingMore: false,
        data: s.data ? { ...more, results: [...s.data.results, ...more.results.filter((r) => !s.data!.results.some((x) => x.id === r.id))] } : more,
      }));
    } catch (e) {
      if (id === reqId.current) setState((s) => ({ ...s, isLoadingMore: false, error: errorText(e) }));
    }
  }, [state.data]);

  const aiSearch = useCallback(async (query: string, owner: "mine" | "all") => {
    const id = ++reqId.current;
    last.current = { kind: "ai", query, owner };
    setState((s) => ({ ...s, isLoading: true, error: null, mode: "ai" }));
    try {
      const data = await sendJson<HubspotSearchResponse>("/api/prospecting/sources/hubspot/ai-search", "POST", {
        query,
        owner: owner === "all" ? "all" : null,
      });
      if (id === reqId.current) setState({ data, error: null, isLoading: false, isLoadingMore: false, mode: "ai" });
    } catch (e) {
      if (id === reqId.current) setState((s) => ({ ...s, data: null, error: errorText(e), isLoading: false }));
    }
  }, []);

  const retry = useCallback(() => {
    const l = last.current;
    if (!l) return;
    if (l.kind === "filters") void search(l.params);
    else void aiSearch(l.query, l.owner);
  }, [search, aiSearch]);

  return { ...state, search, loadMore, aiSearch, retry };
}

// ── Listes sauvegardées & Watch List ────────────────────────────────────────

const SWR_OPTS = { revalidateOnFocus: false, dedupingInterval: 30_000 } as const;

export function useSavedLists(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<{ lists: SavedListSummary[] }>(enabled ? "/api/prospecting/sources/lists" : null, swrFetcher, SWR_OPTS);
  return { lists: data?.lists ?? [], error: error ? errorText(error) : null, isLoading, mutate };
}

export function useSavedList(listId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ list: SavedListDetail }>(listId ? `/api/prospecting/sources/lists/${listId}` : null, swrFetcher, SWR_OPTS);
  return { list: data?.list ?? null, error: error ? errorText(error) : null, isLoading, mutate };
}

export function useWatchlistAccounts(q: string, enabled = true) {
  const key = enabled ? `/api/prospecting/sources/watchlist${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}` : null;
  const { data, error, isLoading, mutate } = useSWR<{ accounts: WatchAccountItem[] }>(key, swrFetcher, { ...SWR_OPTS, keepPreviousData: true });
  return { accounts: data?.accounts ?? [], error: error ? errorText(error) : null, isLoading, mutate };
}

export function useWatchlistContacts(accountId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<WatchContactsResponse>(
    accountId ? `/api/prospecting/sources/watchlist/${accountId}/contacts` : null,
    swrFetcher,
    SWR_OPTS,
  );
  return { data: data ?? null, error: error ? errorText(error) : null, isLoading, mutate };
}

// ── Jobs (LinkedIn, reveal) ─────────────────────────────────────────────────

export function startLinkedinResolve(input: {
  campaignId: string;
  urls: string[];
  options?: { includeRecentlyContacted?: boolean; includeExistingClients?: boolean };
  revealEmails?: boolean;
}) {
  return sendJson<{ job: JobRow }>("/api/prospecting/sources/linkedin", "POST", input);
}

export function startApolloReveal(input: { campaignId?: string; contactIds?: string[]; leads?: LeadInput[] }) {
  return sendJson<{ job: JobRow | null; eligible: number }>("/api/prospecting/sources/apollo/reveal", "POST", input);
}
